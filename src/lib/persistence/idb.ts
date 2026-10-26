const DB_NAME = 'smartpdf-studio'
const DB_VERSION = 1

export const STORE_PDF_FILES = 'pdfFiles'
export const STORE_EDITOR_SESSIONS = 'editorSessions'
export const STORE_IMAGE_ASSETS = 'imageAssets'

export type StorageResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: 'quota' | 'unavailable' | 'unknown'; message: string }

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this browser.'))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_PDF_FILES)) {
        db.createObjectStore(STORE_PDF_FILES)
      }
      if (!db.objectStoreNames.contains(STORE_EDITOR_SESSIONS)) {
        db.createObjectStore(STORE_EDITOR_SESSIONS)
      }
      if (!db.objectStoreNames.contains(STORE_IMAGE_ASSETS)) {
        db.createObjectStore(STORE_IMAGE_ASSETS)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed.'))
  })
}

function classifyIdbError(cause: unknown): StorageResult<never> {
  const name =
    cause instanceof DOMException
      ? cause.name
      : cause instanceof Error
        ? cause.name
        : ''
  if (name === 'QuotaExceededError') {
    return {
      ok: false,
      error: 'quota',
      message:
        'Browser storage is full. Export your PDF or remove local data from the dashboard.',
    }
  }
  if (name === 'InvalidStateError' || name === 'NotFoundError') {
    return {
      ok: false,
      error: 'unavailable',
      message: 'Local storage is unavailable in this browser context.',
    }
  }
  return {
    ok: false,
    error: 'unknown',
    message: cause instanceof Error ? cause.message : 'Storage operation failed.',
  }
}

export async function idbPut(
  storeName: string,
  key: string,
  value: unknown,
): Promise<StorageResult<void>> {
  try {
    const db = await openDatabase()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite')
      tx.objectStore(storeName).put(value, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
    return { ok: true, value: undefined }
  } catch (cause) {
    return classifyIdbError(cause)
  }
}

export async function idbGet<T>(
  storeName: string,
  key: string,
): Promise<StorageResult<T | null>> {
  try {
    const db = await openDatabase()
    const value = await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly')
      const request = tx.objectStore(storeName).get(key)
      request.onsuccess = () => resolve((request.result as T | undefined) ?? null)
      request.onerror = () => reject(request.error)
    })
    db.close()
    return { ok: true, value }
  } catch (cause) {
    return classifyIdbError(cause)
  }
}

export async function idbDelete(storeName: string, key: string): Promise<StorageResult<void>> {
  try {
    const db = await openDatabase()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite')
      tx.objectStore(storeName).delete(key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
    return { ok: true, value: undefined }
  } catch (cause) {
    return classifyIdbError(cause)
  }
}

export async function idbListKeys(storeName: string): Promise<StorageResult<string[]>> {
  try {
    const db = await openDatabase()
    const keys = await new Promise<string[]>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly')
      const request = tx.objectStore(storeName).getAllKeys()
      request.onsuccess = () => {
        resolve((request.result as IDBValidKey[]).map(String))
      }
      request.onerror = () => reject(request.error)
    })
    db.close()
    return { ok: true, value: keys }
  } catch (cause) {
    return classifyIdbError(cause)
  }
}

export async function clearAllLocalPersistence(): Promise<StorageResult<void>> {
  try {
    if (typeof indexedDB === 'undefined') {
      return {
        ok: false,
        error: 'unavailable',
        message: 'IndexedDB is not available.',
      }
    }
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(DB_NAME)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
      request.onblocked = () => resolve()
    })
    return { ok: true, value: undefined }
  } catch (cause) {
    return classifyIdbError(cause)
  }
}
