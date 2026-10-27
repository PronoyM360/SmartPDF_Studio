import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString, rgb, StandardFonts } from 'pdf-lib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildTrackedChanges } from '@/lib/changes/trackedChanges'
import {
  compareContentRecords,
  countAddedStrokeOperators,
  readPageContentRecords,
  type PageContentRecord,
} from '@/lib/pdf/export/contentIntegrity'
import { documentFeatureWarnings, readDocumentFeatures } from '@/lib/pdf/export/documentFeatures'
import { buildExportFilename, downloadPdfBytes } from '@/lib/pdf/export/downloadPdf'
import { exportEditedPdf, ExportValidationError } from '@/lib/pdf/export/exportEditedPdf'
import { selectExportOperations } from '@/lib/pdf/export/exportOperations'
import type { ExportPdfReader, RenderedPage } from '@/lib/pdf/export/exportPdfReader'
import { exportStageIndex } from '@/lib/pdf/export/exportProgress'
import { inspectionChecks } from '@/lib/pdf/export/exportQualityChecks'
import {
  evaluateEdit,
  inspectExportedPdf,
  pixelBox,
  regionDifference,
  regionFillCoverage,
  type EditEvidence,
  type ExportInspection,
} from '@/lib/pdf/export/inspectExportedPdf'
import { comparePageFingerprints, readPdfLibPageFingerprints } from '@/lib/pdf/export/pageFingerprints'
import { imageOverlayPlacement, rotatedImagePlacement, type QuarterTurn } from '@/lib/pdf/export/rotationFrame'
import type { PageRect } from '@/types'
import type { MaskOverlayObject } from '@/types/maskOverlay'
import type { OverlayObject } from '@/types/overlayObjects'
import type { TextOverlayObject } from '@/types/textOverlay'

const NOW = 1_780_000_000_000

function text(partial: Partial<TextOverlayObject> = {}): TextOverlayObject {
  return {
    id: 't1',
    kind: 'text',
    pageIndex: 0,
    bounds: { x: 100, y: 100, width: 80, height: 20 },
    content: '42.00',
    fontFamily: 'Helvetica',
    fontSize: 12,
    color: '#000000',
    alignment: 'left',
    createdAt: NOW,
    updatedAt: NOW,
    ...partial,
  }
}

function mask(partial: Partial<MaskOverlayObject> = {}): MaskOverlayObject {
  return {
    id: 'm1',
    kind: 'mask',
    pageIndex: 0,
    bounds: { x: 100, y: 100, width: 80, height: 20 },
    fillColor: '#ffffff',
    opacity: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...partial,
  }
}

/** 100×100 pt page rendered at scale 1, filled with one colour. */
function render(fill: [number, number, number], paint?: (x: number, y: number) => [number, number, number] | null): RenderedPage {
  const width = 100
  const height = 100
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const color = paint?.(x, y) ?? fill
      data.set([...color, 255], (y * width + x) * 4)
    }
  }
  return { width, height, data, scale: 1, view: { x: 0, y: 0, width, height } }
}

function evidence(partial: Partial<EditEvidence> = {}): EditEvidence {
  return {
    originalRuns: [],
    exportedRuns: [],
    originalRender: null,
    exportedRender: null,
    annotationsAdded: 0,
    flattened: false,
    pageOperations: [],
    ...partial,
  }
}

describe('selectExportOperations', () => {
  it('exports the committed snapshot and reports live, new and hidden objects', () => {
    const committed: OverlayObject[] = [text(), mask({ id: 'hide', mode: 'hide' })]
    const present: OverlayObject[] = [
      text({ content: 'still typing', updatedAt: NOW + 5 }),
      mask({ id: 'hide', mode: 'hide' }),
      mask({ id: 'new' }),
    ]
    const selection = selectExportOperations({ present, committed })
    expect(selection.operations.map((object) => object.id)).toEqual(['t1'])
    expect((selection.operations[0] as TextOverlayObject).content).toBe('42.00')
    expect(selection.excluded).toEqual([
      { id: 't1', kind: 'text', pageIndex: 0, reason: 'uncommitted', committedVersionExported: true },
      { id: 'new', kind: 'mask', pageIndex: 0, reason: 'uncommitted', committedVersionExported: false },
      { id: 'hide', kind: 'mask', pageIndex: 0, reason: 'hidden', committedVersionExported: false },
    ])
    expect(selection.changes.map((change) => change.id)).toEqual(['t1'])
  })

  it('treats the present state as committed when no snapshot is given', () => {
    const selection = selectExportOperations({ present: [text()] })
    expect(selection.excluded).toEqual([])
    expect(selection.operations).toHaveLength(1)
  })
})

describe('page fingerprints', () => {
  it('flags CropBox changes and MediaBox shifts, not only size and rotation', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([300, 400])
    const before = readPdfLibPageFingerprints(doc)
    doc.getPage(0).setCropBox(10, 10, 200, 200)
    doc.getPage(0).setMediaBox(5, 0, 300, 400)
    const result = comparePageFingerprints(before, readPdfLibPageFingerprints(doc))
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toMatch(/MediaBox moved/)
    expect(result.errors.join(' ')).toMatch(/CropBox changed/)
  })

  it('flags a page count change', () => {
    const page = { pageIndex: 0, width: 1, height: 1, rotation: 0, mediaBox: { x: 0, y: 0, width: 1, height: 1 }, cropBox: { x: 0, y: 0, width: 1, height: 1 } }
    expect(comparePageFingerprints([page], []).errors[0]).toMatch(/Page count changed/)
  })
})

describe('content integrity', () => {
  const record = (pageIndex: number, streams: string[], annotationCount = 0): PageContentRecord => ({
    pageIndex,
    streams,
    annotationCount,
  })

  it('classifies identical, preserved and replaced pages', () => {
    const result = compareContentRecords(
      [record(0, ['a']), record(1, ['b']), record(2, ['c'])],
      [record(0, ['a']), record(1, ['q', 'b', 'Q', 'new']), record(2, ['img'])],
      { editedPages: new Set([1]), flattenedPages: new Set([2]) },
    )
    expect(result.ok).toBe(true)
    expect(result.pages.map((page) => page.status)).toEqual(['identical', 'preserved', 'replaced'])
  })

  it('fails when an untouched page changes, original content disappears or annotations are lost', () => {
    const result = compareContentRecords(
      [record(0, ['a']), record(1, ['b'], 2)],
      [record(0, ['a', 'extra']), record(1, ['other'], 1)],
      { editedPages: new Set([1]), flattenedPages: new Set() },
    )
    expect(result.ok).toBe(false)
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'Page 1 had no edits but its content streams changed.',
        'Original content of page 2 was not found unchanged in the export.',
        'Page 2 lost 1 annotation(s) or link(s).',
      ]),
    )
  })

  it('detects reordered pages', () => {
    const result = compareContentRecords(
      [record(0, ['a']), record(1, ['b'])],
      [record(0, ['b']), record(1, ['a'])],
      { editedPages: new Set(), flattenedPages: new Set() },
    )
    expect(result.errors.join(' ')).toMatch(/Page order changed/)
  })

  it('counts stroke operators only in drawing added by the export', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([200, 200])
    page.drawLine({ start: { x: 0, y: 0 }, end: { x: 50, y: 50 }, thickness: 1 })
    const original = await PDFDocument.load(await doc.save())
    const source = readPageContentRecords(original)

    const filled = await PDFDocument.load(await original.save())
    filled.getPage(0).drawRectangle({ x: 10, y: 10, width: 20, height: 20, color: rgb(0, 0, 0), borderWidth: 0 })
    filled.getPage(0).drawText('S B b', { x: 10, y: 50, size: 10, font: await filled.embedFont(StandardFonts.Helvetica) })
    expect(countAddedStrokeOperators(await PDFDocument.load(await filled.save()), source, [0])).toBe(0)

    const stroked = await PDFDocument.load(await original.save())
    stroked.getPage(0).drawRectangle({ x: 10, y: 10, width: 20, height: 20, borderColor: rgb(0, 0, 1), borderWidth: 1 })
    expect(countAddedStrokeOperators(await PDFDocument.load(await stroked.save()), source, [0])).toBeGreaterThan(0)
  })
})

describe('pixel helpers', () => {
  it('maps PDF rects to pixel boxes of an unrotated render', () => {
    expect(pixelBox(render([255, 255, 255]), { x: 10, y: 70, width: 20, height: 10 })).toEqual({ x0: 10, y0: 20, x1: 30, y1: 30 })
    expect(pixelBox(render([255, 255, 255]), { x: 200, y: 200, width: 5, height: 5 })).toBeNull()
  })

  it('measures differences and fill coverage', () => {
    const white = render([255, 255, 255])
    const blackSquare = render([255, 255, 255], (x, y) => (x < 50 && y < 50 ? [0, 0, 0] : null))
    expect(regionDifference(white, white)).toBe(0)
    expect(regionDifference(white, blackSquare)).toBeCloseTo(0.25, 2)
    const topLeft: PageRect = { x: 0, y: 50, width: 50, height: 50 }
    expect(regionFillCoverage(blackSquare, topLeft, '#000000')).toBe(1)
    expect(regionFillCoverage(white, topLeft, '#000000')).toBe(0)
  })
})

describe('evaluateEdit', () => {
  const run = (value: string, bounds: PageRect) => ({ text: value, bounds })

  it('verifies new text found in the text layer and flags the original left underneath', () => {
    const edit = text({
      bounds: { x: 10, y: 10, width: 60, height: 14 },
      content: '15.00',
      replacement: { originalText: '12.50', maskId: 'm1' },
    })
    const changes = buildTrackedChanges([edit, mask({ bounds: edit.bounds })])
    const result = evaluateEdit(
      changes[0]!,
      edit,
      evidence({
        originalRuns: [run('12.50', { x: 12, y: 11, width: 30, height: 12 })],
        exportedRuns: [run('12.50', { x: 12, y: 11, width: 30, height: 12 }), run('15.00', { x: 12, y: 11, width: 30, height: 12 })],
      }),
    )
    expect(result).toMatchObject({ status: 'warning', method: 'text' })
    expect(result.detail).toContain('"12.50" is still in the file underneath')
  })

  it('falls back to rendering when text is not extractable and fails when nothing changed', () => {
    const edit = text({ bounds: { x: 0, y: 50, width: 50, height: 50 } })
    const [change] = buildTrackedChanges([edit])
    const white = render([255, 255, 255])
    const drawn = render([255, 255, 255], (x, y) => (x < 30 && y < 30 ? [0, 0, 0] : null))
    expect(evaluateEdit(change!, edit, evidence({ originalRender: white, exportedRender: drawn }))).toMatchObject({
      status: 'verified',
      method: 'render',
    })
    expect(evaluateEdit(change!, edit, evidence({ originalRender: white, exportedRender: white }))).toMatchObject({
      status: 'failed',
    })
    expect(evaluateEdit(change!, edit, evidence())).toMatchObject({ status: 'not_checked' })
  })

  it('fails covers that do not render, warns on transparent covers and on text left underneath', () => {
    const cover = mask({ bounds: { x: 0, y: 50, width: 50, height: 50 }, fillColor: '#000000' })
    const [change] = buildTrackedChanges([cover])
    const white = render([255, 255, 255])
    const black = render([0, 0, 0])
    expect(evaluateEdit(change!, cover, evidence({ exportedRender: white })).status).toBe('failed')
    expect(evaluateEdit(change!, { ...cover, opacity: 0.5 }, evidence({ exportedRender: black })).status).toBe('warning')
    const hiddenText = evaluateEdit(
      change!,
      cover,
      evidence({ exportedRender: black, exportedRuns: [run('secret', { x: 5, y: 60, width: 20, height: 10 })] }),
    )
    expect(hiddenText.status).toBe('warning')
    expect(hiddenText.detail).toContain('not redaction')
    expect(evaluateEdit(change!, cover, evidence({ exportedRender: black })).status).toBe('verified')
  })

  it('fails redactions that leave extractable text and missing annotations', () => {
    const redaction = mask({ bounds: { x: 0, y: 50, width: 50, height: 50 }, mode: 'redact', fillColor: '#000000' })
    const [change] = buildTrackedChanges([redaction])
    expect(
      evaluateEdit(change!, redaction, evidence({ exportedRuns: [run('secret', { x: 5, y: 60, width: 20, height: 10 })] })).status,
    ).toBe('failed')

    const note: OverlayObject = { id: 'a1', kind: 'annotation', pageIndex: 0, bounds: { x: 0, y: 0, width: 10, height: 10 }, note: 'n', color: '#ff0000', createdAt: NOW, updatedAt: NOW }
    const [noteChange] = buildTrackedChanges([note])
    expect(evaluateEdit(noteChange!, note, evidence({ pageOperations: [note], annotationsAdded: 0 })).status).toBe('failed')
    expect(evaluateEdit(noteChange!, note, evidence({ pageOperations: [note], annotationsAdded: 1 })).status).toBe('verified')
  })
})

describe('inspectionChecks', () => {
  const base: ExportInspection = {
    opened: true,
    error: null,
    originalPageCount: 2,
    exportedPageCount: 2,
    geometryErrors: [],
    pages: [
      { pageIndex: 0, edited: true, flattened: false, textMatchesOriginal: null, pixelDifference: null },
      { pageIndex: 1, edited: false, flattened: false, textMatchesOriginal: true, pixelDifference: 0 },
    ],
    edits: [{ changeId: 'x', kind: 'area', title: 'Area covered', pageIndex: 0, status: 'verified', method: 'render', detail: 'ok' }],
    renderAvailable: true,
  }
  const statusOf = (checks: ReturnType<typeof inspectionChecks>, id: string) => checks.find((check) => check.id === id)?.status

  it('passes a clean inspection', () => {
    const checks = inspectionChecks(base, true)
    expect(statusOf(checks, 'pdfjs_reopen')).toBe('passed')
    expect(statusOf(checks, 'untouched_pages')).toBe('passed')
    expect(statusOf(checks, 'edits_visible')).toBe('passed')
  })

  it('fails on unreadable files, changed untouched pages, page count drift and invisible edits', () => {
    expect(statusOf(inspectionChecks({ ...base, opened: false, error: 'broken' }, true), 'pdfjs_reopen')).toBe('failed')
    expect(statusOf(inspectionChecks({ ...base, exportedPageCount: 3 }, true), 'pdfjs_reopen')).toBe('failed')
    const changedPage = { ...base, pages: [base.pages[0]!, { ...base.pages[1]!, pixelDifference: 0.2 }] }
    expect(statusOf(inspectionChecks(changedPage, true), 'untouched_pages')).toBe('failed')
    const changedText = { ...base, pages: [base.pages[0]!, { ...base.pages[1]!, textMatchesOriginal: false }] }
    expect(statusOf(inspectionChecks(changedText, true), 'untouched_pages')).toBe('failed')
    const invisible = { ...base, edits: [{ ...base.edits[0]!, status: 'failed' as const }] }
    const checks = inspectionChecks(invisible, true)
    expect(statusOf(checks, 'edits_visible')).toBe('failed')
    expect(checks.find((check) => check.id === 'edits_visible')?.subItems?.[0]?.status).toBe('failed')
  })

  it('reports not checked when PDF.js was unavailable', () => {
    const checks = inspectionChecks(null, true)
    expect(checks.map((check) => check.status)).toEqual(['not_checked', 'not_checked', 'not_checked'])
  })
})

describe('inspectExportedPdf resource cleanup', () => {
  function fakeReader(destroyed: string[], name: string, failOn?: string): ExportPdfReader {
    return {
      pageCount: 1,
      readGeometry: async () => {
        if (failOn === 'geometry') {
          throw new Error('boom')
        }
        return { view: { x: 0, y: 0, width: 100, height: 100 }, rotation: 0 }
      },
      readContent: async () => ({ text: [], annotationCount: 0 }),
      renderPage: async () => null,
      destroy: async () => {
        destroyed.push(name)
      },
    }
  }

  const input = (openReader: (bytes: Uint8Array) => Promise<ExportPdfReader>) => ({
    originalBytes: new Uint8Array([1]),
    exportedBytes: new Uint8Array([2]),
    operations: [],
    changes: [],
    flattenedPages: new Set<number>(),
    addedTextByPage: new Map<number, string>(),
    openReader,
  })

  it('destroys both documents even when inspection throws', async () => {
    const destroyed: string[] = []
    let opened = 0
    await expect(
      inspectExportedPdf(input(async () => fakeReader(destroyed, opened++ === 0 ? 'exported' : 'original', 'geometry'))),
    ).rejects.toThrow('boom')
    expect(destroyed.sort()).toEqual(['exported', 'original'])
  })

  it('reports an unreadable export without opening the original', async () => {
    const opened: number[] = []
    const result = await inspectExportedPdf(
      input(async (bytes) => {
        opened.push(bytes[0]!)
        throw new Error('Invalid PDF structure')
      }),
    )
    expect(result).toMatchObject({ opened: false })
    expect(result.error).toContain('Invalid PDF structure')
    expect(opened).toEqual([2])
  })

  it('passes copies so PDF.js cannot detach the caller buffers', async () => {
    const originalBytes = new Uint8Array([1, 2, 3])
    const seen: Uint8Array[] = []
    await inspectExportedPdf({
      ...input(async (bytes) => {
        seen.push(bytes)
        return fakeReader([], 'reader')
      }),
      originalBytes,
    })
    expect(seen.every((bytes) => bytes !== originalBytes)).toBe(true)
  })
})

describe('document features', () => {
  it('detects signatures, forms, revisions, overlapping annotations and embedded images', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([300, 300])
    const form = doc.getForm()
    form.createTextField('name').addToPage(page, { x: 10, y: 10, width: 100, height: 20 })
    const signature = doc.context.obj({ FT: 'Sig', T: PDFString.of('signature'), V: {} })
    const acroForm = doc.catalog.lookup(PDFName.of('AcroForm'), PDFDict)
    acroForm.lookup(PDFName.of('Fields'), PDFArray).push(doc.context.register(signature))
    const png = Uint8Array.from(
      atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg=='),
      (char) => char.charCodeAt(0),
    )
    page.drawImage(await doc.embedPng(png), { x: 150, y: 150, width: 50, height: 50 })
    const saved = await doc.save()
    const withRevision = new Uint8Array([...saved, ...new TextEncoder().encode('\n% update\n%%EOF\n')])

    const features = readDocumentFeatures(await PDFDocument.load(saved), withRevision)
    // One text field (its widget is not a separate field) plus the signature field.
    expect(features).toMatchObject({ signedFieldCount: 1, formFieldCount: 2, incrementalUpdates: 1, encrypted: false })
    expect(features.imageCountByPage).toEqual([1])
    expect(features.annotationsByPage[0]?.[0]?.subtype).toBe('Widget')

    const warnings = documentFeatureWarnings(features, [mask({ bounds: { x: 0, y: 0, width: 300, height: 300 } })]).join(' ')
    expect(warnings).toContain('digital signature')
    expect(warnings).toContain('incremental update')
    expect(warnings).toContain('form field(s)')
    expect(warnings).toContain('overlaps existing annotation(s) (Widget)')
    expect(warnings).toContain('embedded image(s)')
    expect(documentFeatureWarnings(features, [])).not.toEqual(
      expect.arrayContaining([expect.stringContaining('embedded image')]),
    )
  })

  it('blocks encrypted PDFs with a clear message', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([100, 100])
    doc.context.trailerInfo.Encrypt = doc.context.register(doc.context.obj({ Filter: 'Standard', V: 1, R: 2 }))
    const bytes = await doc.save()
    const error = await exportEditedPdf({
      source: { name: 'locked.pdf', byteLength: bytes.byteLength, originalBytes: bytes },
      overlays: [],
      getImageBytes: () => undefined,
    }).catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(ExportValidationError)
    expect((error as ExportValidationError).message).toMatch(/encrypted.*cannot decrypt or re-encrypt/)
  })
})

describe('drawing transforms and text encoding', () => {
  it.each([0, 90, 180, 270] as QuarterTurn[])('places unrotated images like rotatedImagePlacement at %i°', (rotation) => {
    const bounds = { x: 100, y: 200, width: 60, height: 20 }
    const actual = imageOverlayPlacement(bounds, rotation, 0)
    const expected = rotatedImagePlacement(bounds, rotation)
    expect(actual.x).toBeCloseTo(expected.x)
    expect(actual.y).toBeCloseTo(expected.y)
    expect(actual.width).toBeCloseTo(expected.width)
    expect(actual.height).toBeCloseTo(expected.height)
    expect(actual.rotateDegrees).toBeCloseTo(expected.rotateDegrees)
  })

  it('turns images clockwise about their on-screen top-left corner, like the editor', () => {
    const placement = imageOverlayPlacement({ x: 100, y: 200, width: 60, height: 20 }, 0, 90)
    expect(placement.x).toBeCloseTo(80)
    expect(placement.y).toBeCloseTo(220)
    expect(placement.rotateDegrees).toBeCloseTo(270)
    expect([placement.width, placement.height]).toEqual([60, 20])
  })

  it('replaces characters the standard fonts cannot encode instead of failing the export', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([300, 300])
    const bytes = await doc.save()
    const result = await exportEditedPdf({
      source: { name: 'bdt.pdf', byteLength: bytes.byteLength, originalBytes: bytes },
      overlays: [text({ content: '৳ 500' })],
      getImageBytes: () => undefined,
    })
    expect(result.verification.ok).toBe(true)
    expect(result.warnings.join(' ')).toContain('"৳"')
  })
})

describe('download helpers', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('marks file names as edited copies once', () => {
    expect(buildExportFilename('Invoice.PDF')).toBe('Invoice-edited.pdf')
    expect(buildExportFilename('Invoice-edited.pdf')).toBe('Invoice-edited.pdf')
    expect(buildExportFilename('  ')).toBe('document-edited.pdf')
    expect(buildExportFilename('a/b:c.pdf')).toBe('a-b-c-edited.pdf')
  })

  it('revokes the object URL later, or immediately when released, exactly once', () => {
    vi.useFakeTimers()
    const click = vi.fn()
    vi.stubGlobal('document', { createElement: () => ({ click }) })
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)

    const release = downloadPdfBytes(new Uint8Array([1, 2, 3]), 'x-edited.pdf')
    expect(create).toHaveBeenCalledTimes(1)
    expect(click).toHaveBeenCalledTimes(1)
    expect(revoke).not.toHaveBeenCalled()
    vi.advanceTimersByTime(60_000)
    expect(revoke).toHaveBeenCalledWith('blob:test')

    const releaseEarly = downloadPdfBytes(new Uint8Array([1]), 'y-edited.pdf')
    releaseEarly()
    releaseEarly()
    vi.advanceTimersByTime(60_000)
    release()
    expect(revoke).toHaveBeenCalledTimes(2)
  })
})

describe('export stages', () => {
  it('orders the progress stages', () => {
    expect(['preparing', 'applying', 'saving', 'validating', 'done'].map((stage) => exportStageIndex(stage as never))).toEqual([0, 1, 2, 3, 4])
  })
})
