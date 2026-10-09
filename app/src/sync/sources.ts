export type TelegramCloudStorage = {
  getKeys(callback: (error: unknown, keys?: string[]) => void): void
  getItems(keys: string[], callback: (error: unknown, values?: Record<string, string>) => void): void
}

const cloudCall = <T>(run: (callback: (error: unknown, value?: T) => void) => void) =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Telegram storage did not respond; migration is still pending')), 15_000)
    const callback = (error: unknown, value?: T) => {
      clearTimeout(timer)
      if (error || value === undefined) reject(new Error('Telegram storage could not be read; migration is still pending'))
      else resolve(value)
    }
    try { run(callback) } catch { callback(true) }
  })

/** Do not substitute the local mirror or treat a failed callback as an empty account. */
export async function readTelegramCloudSnapshot(storage: TelegramCloudStorage | undefined) {
  if (!storage) throw new Error('Open this app in Telegram to migrate CloudStorage')
  const keys = await cloudCall<string[]>(done => storage.getKeys(done))
  if (!Array.isArray(keys) || keys.some(key => typeof key !== 'string') || new Set(keys).size !== keys.length) throw new Error('Invalid Telegram storage key list')
  const snapshot: Record<string, string> = Object.create(null)
  for (let offset = 0; offset < keys.length; offset += 100) {
    const part = keys.slice(offset, offset + 100)
    const values = await cloudCall<Record<string, string>>(done => storage.getItems(part, done))
    for (const key of part) {
      if (!Object.hasOwn(values, key) || typeof values[key] !== 'string') throw new Error('Telegram storage changed while reading; retry the migration')
      snapshot[key] = values[key]
    }
  }
  return snapshot
}

export type LegacyDeviceSnapshot = { studies: unknown[]; annotations: unknown[]; localValues: Record<string, string> }

/** Reads a single IndexedDB snapshot and the enumerable local mirror, never writes source data. */
export async function readLegacyDeviceSnapshot(factory: IDBFactory, storage: Pick<Storage, 'length' | 'key' | 'getItem'>): Promise<LegacyDeviceSnapshot> {
  const snapshot = await new Promise<{ studies: unknown[]; annotations: unknown[] }>((resolve, reject) => {
    const request = factory.open('cyberjudah-personal-study')
    let absent = false
    request.onupgradeneeded = event => {
      if (event.oldVersion === 0) {
        absent = true
        request.transaction?.abort() // Do not create an empty legacy database as a side effect.
        resolve({ studies: [], annotations: [] })
      } else {
        request.transaction?.abort()
        reject(new Error('Unsupported local study database; source preserved'))
      }
    }
    request.onerror = () => { if (!absent) reject(new Error('Local study database could not be read')) }
    request.onblocked = () => reject(new Error('Close the older app tab and retry local migration'))
    request.onsuccess = () => {
      const db = request.result
      try {
        const tx = db.transaction(['studies', 'annotations'], 'readonly')
        const studies = tx.objectStore('studies').getAll()
        const annotations = tx.objectStore('annotations').getAll()
        tx.oncomplete = () => { db.close(); resolve({ studies: studies.result, annotations: annotations.result }) }
        tx.onabort = tx.onerror = () => { db.close(); reject(new Error('Local study snapshot failed; source preserved')) }
      } catch { db.close(); reject(new Error('Unsupported local study database; source preserved')) }
    }
  })
  const localValues: Record<string, string> = Object.create(null)
  // Includes local-only notes and tabs, not just cloud-backed keys. Read errors abort the pass.
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)
    if (!key?.startsWith('cj:') || key.startsWith('cj:migration:')) continue
    const value = storage.getItem(key)
    if (value !== null) localValues[key.slice(3)] = value
  }
  return { ...snapshot, localValues }
}
