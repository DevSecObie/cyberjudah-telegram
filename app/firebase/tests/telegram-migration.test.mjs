import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, doc, getDoc, getDocs, updateDoc, deleteDoc, setDoc } from 'firebase/firestore'

const output = new URL('../../tests/.build/telegram-migration.mjs', import.meta.url).pathname
await build({ entryPoints: [new URL('../../src/sync/migration.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile: output, logLevel: 'error' })
const { migrateTelegramSource, migrationDocumentId, deviceMigrationKey, DEVICE_MIGRATION_OWNER_KEY } = await import(output)
let environment
before(async () => { environment = await initializeTestEnvironment({ projectId: 'demo-telegram-migration', firestore: { host: '127.0.0.1', port: 8089, rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') } }) })
after(async () => environment?.cleanup())
const store = (uid) => {
  const entries = new Map([[DEVICE_MIGRATION_OWNER_KEY, uid]])
  return { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) }
}
async function note(sourceIdentity, description = 'Preserved source text') {
  return { collection: 'notes', sourceIdentity, id: await migrationDocumentId(sourceIdentity), data: { title: 'Imported note', description, date: 1700000000000 } }
}
function options(uid, records, source = 'cloudStorage', deviceStore = store(uid)) {
  return { db: environment.authenticatedContext(uid).firestore(), uid, source, deviceStore, currentUid: () => uid, readAndConvert: async () => records }
}

test('interruption resumes with one initial snapshot per note and preserves subsequent edits', async () => {
  const uid = 'tg_101', records = await Promise.all(['one', 'two', 'three'].map(id => note(id)))
  const setup = options(uid, records)
  await assert.rejects(migrateTelegramSource({ ...setup, onRecordCommitted: () => { throw new Error('Interrupted after committed batch') } }), /Interrupted/)
  const notes = collection(setup.db, 'users', uid, 'notes')
  assert.equal((await getDocs(notes)).size, 1)
  assert.equal((await getDoc(doc(setup.db, 'users', uid))).data()?.telegramMigration, undefined)
  await updateDoc(doc(notes, records[0].id), { description: 'Edited after import' })
  await migrateTelegramSource(setup)
  assert.equal((await getDocs(notes)).size, 3)
  assert.equal((await getDoc(doc(notes, records[0].id))).data().description, 'Edited after import')
  for (const record of records) {
    const revisions = await getDocs(collection(doc(notes, record.id), 'revisions'))
    assert.equal(revisions.size, 1)
    assert.equal(revisions.docs[0].data().snapshot.description, 'Preserved source text')
  }
  assert.equal((await getDoc(doc(setup.db, 'users', uid))).data().telegramMigration.cloudStorageBySource.app.migrationVersion, 1)
  assert.equal((await migrateTelegramSource(setup)).alreadyComplete, true)
})

test('a completed CloudStorage pass never skips a second device IndexedDB pass; overlap is idempotent', async () => {
  const uid = 'tg_102', common = await note('shared-source')
  const cloud = options(uid, [common])
  await migrateTelegramSource(cloud)
  const first = options(uid, [common, await note('device-one')], 'indexedDB')
  const second = options(uid, [common, await note('device-two')], 'indexedDB')
  await migrateTelegramSource(first)
  assert.equal(second.deviceStore.getItem(deviceMigrationKey(uid)), null)
  await migrateTelegramSource(second)
  assert.equal((await getDocs(collection(cloud.db, 'users', uid, 'notes'))).size, 3)
  for (const device of [first, second]) assert.equal(JSON.parse(device.deviceStore.getItem(deviceMigrationKey(uid))).migrationVersion, 1)
  assert.deepEqual(Object.keys((await getDoc(doc(cloud.db, 'users', uid))).data().telegramMigration), ['cloudStorageBySource'])
  assert.equal(first.deviceStore.getItem(deviceMigrationKey('tg_103')), null)
})

test('device interruptions and storage errors leave the local commit point unset', async () => {
  const setup = options('tg_104', [await note('local-a'), await note('local-b')], 'indexedDB')
  await assert.rejects(migrateTelegramSource({ ...setup, onRecordCommitted: () => { throw new Error('Interrupted') } }))
  assert.equal(setup.deviceStore.getItem(deviceMigrationKey(setup.uid)), null)
  await assert.rejects(migrateTelegramSource({ ...setup, deviceStore: { ...setup.deviceStore, setItem: () => { throw new Error('Storage full') } } }), /Storage full/)
  assert.equal(setup.deviceStore.getItem(deviceMigrationKey(setup.uid)), null)
  await migrateTelegramSource(setup)
  assert.equal((await getDocs(collection(setup.db, 'users', setup.uid, 'notes'))).size, 2)
})

test('source failures, malformed records, oversized studies and account changes never mark completion', async () => {
  const setup = options('tg_105', [await note('valid-first')])
  const badRecord = { collection: 'studies', id: 'large', sourceIdentity: 'oversized', data: { user: { id: setup.uid }, text: 'x'.repeat(800000) } }
  for (const changed of [
    { readAndConvert: async () => { throw new Error('CloudStorage read failed') } },
    { readAndConvert: async () => [...await setup.readAndConvert(), badRecord] },
    { readAndConvert: async () => [{ ...badRecord, collection: 'permissions' }] },
    { currentUid: () => 'tg_999' },
    { source: 'indexedDB', deviceStore: store('tg_999') },
  ]) await assert.rejects(migrateTelegramSource({ ...setup, ...changed }))
  assert.equal((await getDocs(collection(setup.db, 'users', setup.uid, 'notes'))).size, 0)
  assert.equal((await getDoc(doc(setup.db, 'users', setup.uid))).exists(), false)
})

test('retries preserve deletions and refuse changed source text rather than dropping a different version', async () => {
  const first = await note('source-edit')
  const setup = options('tg_106', [first, await note('remaining')])
  await assert.rejects(migrateTelegramSource({ ...setup, onRecordCommitted: () => { throw new Error('Interrupted') } }))
  const ref = doc(setup.db, 'users', setup.uid, 'notes', first.id)
  await deleteDoc(ref)
  await assert.rejects(migrateTelegramSource({ ...setup, readAndConvert: async () => [await note('source-edit', 'Changed elsewhere')] }), /source changed/)
  assert.equal((await getDoc(doc(setup.db, 'users', setup.uid))).exists(), false)
  await migrateTelegramSource(setup)
  assert.equal((await getDoc(ref)).exists(), false, 'a user deletion is not resurrected')
  assert.equal((await getDocs(collection(ref, 'revisions'))).size, 1)
})

test('concurrent source imports use read preconditions and produce no duplicate note or revision', async () => {
  const record = await note('concurrent')
  const one = options('tg_107', [record]), two = options('tg_107', [record])
  await Promise.all([migrateTelegramSource(one), migrateTelegramSource(two)])
  assert.equal((await getDocs(collection(one.db, 'users', one.uid, 'notes'))).size, 1)
  assert.equal((await getDocs(collection(one.db, 'users', one.uid, 'notes', record.id, 'revisions'))).size, 1)
})

test('private study and other converted document shapes are accepted by the exact authorized rules', async () => {
  const uid = 'tg_108'
  const records = ['studies', 'highlights', 'wordAnnotations', 'bookmarks', 'links', 'tags', 'relations', 'tabGroups'].map(collection => ({ collection, id: `shape-${collection}`, sourceIdentity: collection, data: collection === 'studies' ? { user: { id: uid }, title: 'Private study', content: { ops: [{ insert: 'Preserved text\n' }] } } : { id: `shape-${collection}`, date: 1700000000000 } }))
  const setup = options(uid, records, 'indexedDB')
  await migrateTelegramSource(setup)
  for (const record of records) assert.equal((await getDoc(doc(setup.db, 'users', uid, record.collection, record.id))).exists(), true)
  assert.equal((await getDocs(collection(setup.db, 'users', uid, 'studies', 'shape-studies', 'revisions'))).size, 1)
})

test('the staging bot and an earlier unscoped marker cannot skip the production bot import', async () => {
  const setup = options('tg_109', [await note('production-cloud-note')])
  const root = doc(setup.db, 'users', setup.uid)
  // A prior preview used an unscoped marker. Keep it intact, but never treat it as proof
  // that a different bot's CloudStorage has been imported.
  await setDoc(root, { telegramMigration: { cloudStorage: { migrationVersion: 1 } } })
  await migrateTelegramSource({ ...setup, cloudStorageScope: 'staging', readAndConvert: async () => [] })
  assert.equal((await getDocs(collection(setup.db, 'users', setup.uid, 'notes'))).size, 0)
  assert.equal((await migrateTelegramSource(setup)).imported, 1)
  assert.equal((await getDocs(collection(setup.db, 'users', setup.uid, 'notes'))).size, 1)
  assert.deepEqual((await getDoc(root)).data().telegramMigration, {
    cloudStorage: { migrationVersion: 1 },
    cloudStorageBySource: { app: { migrationVersion: 1 }, staging: { migrationVersion: 1 } },
  })
  assert.equal((await migrateTelegramSource(setup)).alreadyComplete, true)
})
