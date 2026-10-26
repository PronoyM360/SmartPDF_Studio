import { describe, expect, it } from 'vitest'
import { validatePersistedSession } from '@/lib/persistence/editorSessionStore'
import { PERSISTENCE_SCHEMA_VERSION } from '@/types/persistedSession'

describe('validatePersistedSession', () => {
  it('accepts a valid session payload', () => {
    const session = validatePersistedSession({
      schemaVersion: PERSISTENCE_SCHEMA_VERSION,
      documentId: 'doc-1',
      lastModifiedAt: new Date().toISOString(),
      activePage: 1,
      zoomPercent: 100,
      fitMode: 'page',
      overlayObjects: [],
      imageAssets: [],
    })
    expect(session?.documentId).toBe('doc-1')
  })

  it('rejects unknown schema versions', () => {
    expect(
      validatePersistedSession({
        schemaVersion: 999,
        documentId: 'doc-1',
        overlayObjects: [],
      }),
    ).toBeNull()
  })
})
