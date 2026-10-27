import { PDFDocument, StandardFonts, degrees } from 'pdf-lib'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { describe, expect, it } from 'vitest'
import {
  MIN_SELECTABLE_TEXT_CHARS,
  analyzePageText,
} from '@/lib/sections/analyzePageText'
import { detectPageSections } from '@/lib/sections/detectPageSections'

/** 1×1 grey PNG — stands in for a scanned page image. */
const PNG_1PX = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==',
  ),
  (char) => char.charCodeAt(0),
)

async function buildFixture(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)

  const ticket = doc.addPage([612, 792])
  ticket.drawText('PASSENGER DETAILS', { x: 40, y: 720, size: 12, font: bold })
  ticket.drawText('MR JOHN DOE', { x: 40, y: 704, size: 10, font })
  ticket.drawText('Total Amount', { x: 40, y: 600, size: 10, font })
  ticket.drawText('USD 155.50', { x: 420, y: 600, size: 10, font })

  // /Rotate 90 with horizontal user-space text: appears sideways on screen.
  const rotated = doc.addPage([612, 792])
  rotated.setRotation(degrees(90))
  rotated.drawText('BAGGAGE ALLOWANCE', { x: 40, y: 720, size: 12, font: bold })
  rotated.drawText('Checked: 20 KG', { x: 40, y: 704, size: 10, font })
  rotated.drawText('TERMS AND CONDITIONS', { x: 40, y: 600, size: 12, font: bold })
  rotated.drawText('Tickets are non-refundable after departure.', { x: 40, y: 584, size: 9, font })

  const scanned = doc.addPage([612, 792])
  const image = await doc.embedPng(PNG_1PX)
  scanned.drawImage(image, { x: 0, y: 0, width: 612, height: 792 })

  const plain = doc.addPage([612, 792])
  plain.drawText('Meeting notes from the community garden committee.', { x: 40, y: 720, size: 10, font })

  // Landscape-style page: /Rotate 90 with text drawn rotated so it reads upright on screen.
  const landscape = doc.addPage([612, 792])
  landscape.setRotation(degrees(90))
  landscape.drawText('FLIGHT DETAILS', { x: 100, y: 40, size: 12, font: bold, rotate: degrees(90) })
  landscape.drawText('BG 147 DAC 10:30', { x: 116, y: 40, size: 10, font, rotate: degrees(90) })

  return doc.save()
}

async function openFixture(): Promise<PDFDocumentProxy> {
  const data = await buildFixture()
  return (await pdfjs.getDocument({ data, verbosity: 0 }).promise) as unknown as PDFDocumentProxy
}

describe('analyzePageText (real pdf.js)', async () => {
  const pdf = await openFixture()

  it('returns selectable text runs in PDF user space', async () => {
    const analysis = await analyzePageText(pdf, 0)
    const heading = analysis.runs.find((entry) => entry.text.includes('PASSENGER'))
    expect(heading).toBeDefined()
    // drawText baseline at y=720 → box should straddle it in bottom-left PDF space.
    expect(heading!.bounds.y).toBeLessThan(720)
    expect(heading!.bounds.y + heading!.bounds.height).toBeGreaterThan(720)
    expect(analysis.hasImages).toBe(false)
    expect(analysis.textCharCount).toBeGreaterThan(MIN_SELECTABLE_TEXT_CHARS)

    const display = analysis.toDisplayRect(heading!.bounds)
    expect(display.y).toBeLessThan(80)
  })

  it('detects sections end-to-end on a selectable-text page', async () => {
    const analysis = await analyzePageText(pdf, 0)
    const sections = detectPageSections({ ...analysis, textSource: 'pdf_text' })
    const passenger = sections.find((section) => section.category === 'passenger')
    expect(passenger?.text).toContain('MR JOHN DOE')
    expect(sections.find((section) => section.category === 'total')?.text).toContain('155.50')
  })

  it('analyzes sideways text on a rotated page in its own reading direction', async () => {
    const analysis = await analyzePageText(pdf, 1)
    expect(analysis.rotation).toBe(90)
    expect(analysis.readingRotation).toBe(0)
    const sections = detectPageSections({ ...analysis, textSource: 'pdf_text' })
    const baggage = sections.find((section) => section.category === 'baggage')
    expect(baggage?.text.startsWith('BAGGAGE ALLOWANCE\nChecked: 20 KG')).toBe(true)
    expect(sections.find((section) => section.category === 'terms')?.text).toContain('non-refundable')
    // Section bounds still enclose the original text box in PDF space.
    const run = analysis.runs.find((entry) => entry.text.includes('Checked'))!
    expect(baggage!.bounds.x).toBeLessThanOrEqual(run.bounds.x + 0.5)
    expect(baggage!.bounds.y).toBeLessThanOrEqual(run.bounds.y + 0.5)
  })

  it('analyzes upright text on a rotated (landscape) page', async () => {
    const analysis = await analyzePageText(pdf, 4)
    expect(analysis.rotation).toBe(90)
    expect(analysis.readingRotation).toBe(90)
    expect(analysis.displayWidth).toBeCloseTo(792)
    const sections = detectPageSections({ ...analysis, textSource: 'pdf_text' })
    const flight = sections.find((section) => section.category === 'flight')
    expect(flight?.text).toBe('FLIGHT DETAILS\nBG 147 DAC 10:30')
  })

  it('reports image-only pages as needing OCR', async () => {
    const analysis = await analyzePageText(pdf, 2)
    expect(analysis.runs).toHaveLength(0)
    expect(analysis.textCharCount).toBeLessThan(MIN_SELECTABLE_TEXT_CHARS)
    expect(analysis.hasImages).toBe(true)
    expect(detectPageSections({ ...analysis, textSource: 'pdf_text' })).toEqual([])
  })

  it('keeps unrecognized documents as unclassified blocks', async () => {
    const analysis = await analyzePageText(pdf, 3)
    const sections = detectPageSections({ ...analysis, textSource: 'pdf_text' })
    expect(sections).toHaveLength(1)
    expect(sections[0]?.category).toBe('other')
  })
})
