import { describe, expect, it } from 'vitest'
import { recoveryIsNewerThanSaved } from '@/lib/persistence/recoverySession'
import { PERSISTENCE_SCHEMA_VERSION } from '@/types/persistedSession'

function session(documentId: string, iso: string) {
  return {
    schemaVersion: PERSISTENCE_SCHEMA_VERSION,
    documentId,
    lastModifiedAt: iso,
    activePage: 1,
    zoomPercent: 100,
    fitMode: 'page' as const,
    overlayObjects: [],
    imageAssets: [],
  }
}

describe('recoveryIsNewerThanSaved', () => {
  it('prefers recovery when timestamps are newer', () => {
    expect(
      recoveryIsNewerThanSaved(
        session('a', '2026-01-01T10:00:00.000Z'),
        session('a', '2026-01-01T11:00:00.000Z'),
      ),
    ).toBe(true)
  })

  it('ignores recovery when older than saved', () => {
    expect(
      recoveryIsNewerThanSaved(
        session('a', '2026-01-01T12:00:00.000Z'),
        session('a', '2026-01-01T11:00:00.000Z'),
      ),
    ).toBe(false)
  })
})
