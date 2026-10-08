import { doc, getDocFromServer, runTransaction, setDoc, type Firestore } from 'firebase/firestore'

export const TELEGRAM_MIGRATION_VERSION = 1
export type MigrationRecord = {
  collection: 'notes' | 'studies' | 'highlights' | 'wordAnnotations' | 'bookmarks' | 'links' | 'tags' | 'relations' | 'tabGroups'
  id: string
  sourceIdentity: string
  data: Record<string, unknown>
}
type DeviceStore = Pick<Storage, 'getItem' | 'setItem'>
type MigrationOptions = {
  db: Firestore
  uid: string
  source: 'cloudStorage' | 'indexedDB'
  cloudStorageScope?: 'app' | 'staging'
  deviceStore: DeviceStore
  readAndConvert(): Promise<MigrationRecord[]>
  /** Refuse an account switch before any read/write or completion flag. */
  currentUid(): string | undefined
  onRecordCommitted?(record: MigrationRecord): void
}

export const deviceMigrationKey = (uid: string) => `cj:migration:indexedDB:${uid}`
export const DEVICE_MIGRATION_OWNER_KEY = 'cj:migration:indexedDB-owner'

/** Stable across retries/devices. The input is source identity, never a clock or random ID. */
export async function migrationDocumentId(sourceIdentity: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sourceIdentity))
  return 'tg-v1-' + [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('')
}

const revisionId = 'telegram-v1-initial'
const allowed = new Set(['notes', 'studies', 'highlights', 'wordAnnotations', 'bookmarks', 'links', 'tags', 'relations', 'tabGroups'])

/**
 * One independent pass per source. Importing cannot run offline: only acknowledged
 * writes allow the commit point. Normal edits use the SDK's persistent offline queue.
 * This is called only after the entire source converter accepts the snapshot.
 */
export async function migrateTelegramSource(options: MigrationOptions) {
  const { db, uid, source, deviceStore, readAndConvert, currentUid } = options
  const assertOwner = () => { if (!/^tg_[1-9][0-9]*$/.test(uid) || currentUid() !== uid) throw new Error('Migration account changed; no completion flag was written') }
  assertOwner()
  if (source === 'indexedDB' && deviceStore.getItem(DEVICE_MIGRATION_OWNER_KEY) !== uid) throw new Error('Confirm which account owns this device data before importing it')
  const userRef = doc(db, 'users', uid)
  const deviceKey = deviceMigrationKey(uid)
  const scope = options.cloudStorageScope ?? 'app'
  const state = source === 'cloudStorage'
    ? (await getDocFromServer(userRef)).data()?.telegramMigration?.cloudStorageBySource?.[scope]
    : JSON.parse(deviceStore.getItem(deviceKey) ?? 'null')
  assertOwner()
  if (Number(state?.migrationVersion ?? 0) >= TELEGRAM_MIGRATION_VERSION) return { imported: 0, alreadyComplete: true }
  const records = await readAndConvert()
  assertOwner()
  // Validate the full plan before the first write. Unknown/oversized records keep the pass pending.
  const paths = new Map<string, string>()
  const fingerprints = new Map<MigrationRecord, string>()
  for (const record of records) {
    if (!allowed.has(record.collection) || !/^[A-Za-z0-9_-]{1,200}$/.test(record.id) || !record.sourceIdentity || !record.data || typeof record.data !== 'object' || Array.isArray(record.data)) throw new Error('Invalid migration record')
    if (record.collection === 'studies' && (record.data.user as { id?: string } | undefined)?.id !== uid) throw new Error('A private study must carry its owner ID')
    if (new TextEncoder().encode(JSON.stringify(record.data)).length > 750_000) throw new Error('This study needs the reviewed large-document migration; the source has been preserved')
    const path = `${record.collection}/${record.id}`
    const fingerprint = await migrationDocumentId(JSON.stringify(record.data))
    if (paths.has(path) && paths.get(path) !== `${record.sourceIdentity}:${fingerprint}`) throw new Error('Conflicting migration identities')
    paths.set(path, `${record.sourceIdentity}:${fingerprint}`)
    fingerprints.set(record, fingerprint)
  }
  for (const record of records) {
    assertOwner()
    const ref = doc(db, 'users', uid, record.collection, record.id)
    const hasRevisions = record.collection === 'notes' || record.collection === 'studies'
    // A Firestore transaction commits the note + initial revision atomically and adds
    // a read precondition. A blind writeBatch could overwrite another device's edit.
    await runTransaction(db, async transaction => {
      assertOwner()
      const previous = await transaction.get(ref)
      const revision = hasRevisions ? doc(ref, 'revisions', revisionId) : undefined
      const initial = revision ? await transaction.get(revision) : undefined
      if (initial?.exists()) {
        if (initial.data().sourceIdentity !== record.sourceIdentity || initial.data().sourceFingerprint !== fingerprints.get(record)) throw new Error('The source changed since its first import; both versions have been preserved')
        return // Keep subsequent edits AND deletions; never resurrect an imported note.
      }
      if (previous.exists()) {
        if (!hasRevisions && previous.data().migrationSourceIdentity === record.sourceIdentity && previous.data().migrationSourceFingerprint === fingerprints.get(record)) return
        throw new Error('An existing record conflicts with this import; neither copy was replaced')
      }
      const data = { ...record.data, migrationSourceIdentity: record.sourceIdentity, migrationSourceFingerprint: fingerprints.get(record) }
      transaction.set(ref, data)
      if (revision) transaction.set(revision, { snapshot: data, sourceIdentity: record.sourceIdentity, sourceFingerprint: fingerprints.get(record), migrationVersion: TELEGRAM_MIGRATION_VERSION, user: { id: uid } })
    })
    options.onRecordCommitted?.(record)
  }
  assertOwner()
  const completed = { migrationVersion: TELEGRAM_MIGRATION_VERSION }
  if (source === 'cloudStorage') {
    await setDoc(userRef, { telegramMigration: { cloudStorageBySource: { [scope]: completed } } }, { merge: true })
  } else {
    // Deliberately local and UID-scoped. Another device must still import its own IndexedDB.
    deviceStore.setItem(deviceKey, JSON.stringify(completed))
  }
  return { imported: records.length, alreadyComplete: false }
}
