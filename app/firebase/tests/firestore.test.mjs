import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, query, where, writeBatch, deleteField, increment } from 'firebase/firestore'
let environment
before(async () => {
  environment = await initializeTestEnvironment({ projectId: 'demo-cyberjudah', firestore: { host: '127.0.0.1', port: 8089, rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') } })
})
after(async () => environment?.cleanup())
const db = uid => uid ? environment.authenticatedContext(uid).firestore() : environment.unauthenticatedContext().firestore()

test('reader data and every upstream saved collection stay private to the owner', async () => {
  const alice = db('alice'), bob = db('bob'), guest = db()
  const collections = ['bookmarks', 'highlights', 'notes', 'links', 'relations', 'relationIndex', 'relationPairs', 'tags', 'wordAnnotations', 'strongsHebreu', 'strongsGrec', 'words', 'naves', 'studies', 'tabGroups']
  for (const path of ['users/alice', ...collections.map(name => `users/alice/${name}/saved`)]) {
    await assertSucceeds(setDoc(doc(alice, path), { title: 'Private reader fixture', content: 'A note' }))
    await assertSucceeds(getDoc(doc(alice, path)))
    for (const other of [bob, guest]) {
      await assertFails(getDoc(doc(other, path)))
      await assertFails(setDoc(doc(other, path), { title: 'Overwrite attempt' }))
      await assertFails(deleteDoc(doc(other, path)))
    }
  }
  await assertFails(getDocs(collection(bob, 'users/alice/notes')))
  await assertFails(getDocs(collection(bob, 'users')))
  await assertFails(setDoc(doc(alice, 'users/alice/permissions/admin'), { admin: true }))
  await assertFails(setDoc(doc(alice, 'users/alice/notes/saved/permissions/admin'), { admin: true }))
})

test('a published study cannot be overwritten, transferred or deleted by another reader', async () => {
  const alice = db('alice'), bob = db('bob'), path = 'studies/shared-fixture'
  await assertSucceeds(setDoc(doc(alice, path), { user: { id: 'alice' }, title: 'Published fixture' }))
  await assertSucceeds(getDoc(doc(bob, path)))
  await assertFails(getDoc(doc(db(), path)))
  await assertFails(setDoc(doc(bob, 'studies/forged-owner'), { user: { id: 'alice' } }))
  await assertFails(setDoc(doc(bob, path), { user: { id: 'bob' }, title: 'Takeover' }))
  await assertFails(updateDoc(doc(alice, path), { 'user.id': 'bob' }))
  await assertFails(deleteDoc(doc(bob, path)))
  await assertSucceeds(updateDoc(doc(alice, path), { title: 'Revised fixture' }))
  await assertSucceeds(deleteDoc(doc(alice, path)))
})

test('an existing owner can migrate saved notes and sync tabs without exposing either account', async () => {
  const owner = db('existing-owner')
  const note = { title: 'Existing note', description: 'Saved before the fork update' }
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'users/existing-owner'), { bible: { notes: { saved: note }, settings: { theme: 'dark' } } })
  })
  const original = (await assertSucceeds(getDoc(doc(owner, 'users/existing-owner')))).data()
  const batch = writeBatch(owner)
  batch.set(doc(owner, 'users/existing-owner/notes/saved'), original.bible.notes.saved)
  batch.set(doc(owner, 'users/existing-owner/tabGroups/main'), { name: 'My tabs', tabs: [{ id: 'reader', type: 'bible' }] })
  batch.update(doc(owner, 'users/existing-owner'), { 'bible.notes': deleteField(), _migrated: true })
  await assertSucceeds(batch.commit())
  assert.deepEqual((await getDoc(doc(owner, 'users/existing-owner/notes/saved'))).data(), note)
  assert.deepEqual((await getDoc(doc(owner, 'users/existing-owner'))).data().bible.settings, { theme: 'dark' })
  await assertSucceeds(getDocs(collection(owner, 'users/existing-owner/tabGroups')))
  await assertFails(getDocs(collection(db('next-account'), 'users/existing-owner/tabGroups')))
  await assertFails(getDoc(doc(db(), 'users/existing-owner/notes/saved')))
})

test('the existing root and public reference collections keep their read access', async () => {
  const publicPaths = ['stats/total', 'stats/total/days/today', 'verse-commentaries/verse', 'verse-commentaries/verse/entries/one', 'plans/legacy', 'plans/legacy/days/one', 'changelog/release']
  const rootPaths = ['root/config', 'root/config/content/shared']
  await environment.withSecurityRulesDisabled(async context => {
    for (const path of [...publicPaths, ...rootPaths]) {
      await setDoc(doc(context.firestore(), path), { title: 'Existing shared fixture', downloads: 4 })
    }
  })
  for (const path of publicPaths) {
    await assertSucceeds(getDoc(doc(db(), path)))
    await assertSucceeds(getDoc(doc(db('reader'), path)))
    await assertFails(updateDoc(doc(db('reader'), path), { title: 'Untrusted content' }))
    await assertFails(deleteDoc(doc(db('reader'), path)))
  }
  for (const path of rootPaths) {
    await assertSucceeds(getDoc(doc(db('reader'), path)))
    await assertFails(getDoc(doc(db(), path)))
    await assertFails(setDoc(doc(db('reader'), path), { admin: true }))
  }
})

test('legacy clients can only increment a plan download counter by one', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'plans/legacy-counter'), { title: 'Existing plan', downloads: 4 })
  })
  const plan = doc(db(), 'plans/legacy-counter')
  await assertSucceeds(updateDoc(plan, { downloads: increment(1) }))
  assert.equal((await getDoc(plan)).data().downloads, 5)
  for (const changes of [{ downloads: 0 }, { downloads: 100 }, { downloads: 'six' }, { downloads: 6, title: 'Changed content' }]) {
    await assertFails(updateDoc(plan, changes))
  }
  await assertFails(setDoc(doc(db(), 'plans/new-client-plan'), { downloads: 1 }))
})

test('connection status is private and cannot change another account', async () => {
  const path = 'users-status/alice'
  await assertSucceeds(setDoc(doc(db('alice'), path), { online: true }))
  await assertSucceeds(getDoc(doc(db('alice'), path)))
  for (const uid of ['bob', undefined]) {
    await assertFails(getDoc(doc(db(uid), path)))
    await assertFails(setDoc(doc(db(uid), path), { online: false }))
  }
})

test('private note and study revisions allow owner access and deny other accounts', async () => {
  for (const kind of ['notes', 'studies']) {
    const path = `users/revision-owner/${kind}/parent/revisions/initial`
    const owner = db('revision-owner')
    await assertSucceeds(setDoc(doc(owner, path), { title: 'Previous state', user: { id: 'revision-owner' } }))
    await assertSucceeds(getDoc(doc(owner, path)))
    await assertSucceeds(getDocs(collection(owner, `users/revision-owner/${kind}/parent/revisions`)))
    for (const uid of ['other-reader', undefined]) {
      await assertFails(getDoc(doc(db(uid), path)))
      await assertFails(setDoc(doc(db(uid), path), { title: 'Takeover', user: { id: uid || 'guest' } }))
      await assertFails(deleteDoc(doc(db(uid), path)))
    }
    await assertSucceeds(deleteDoc(doc(owner, path)))
  }
})

test('a note and its deterministic initial revision can be committed in one batch', async () => {
  const owner = db('migration-owner')
  const path = 'users/migration-owner/notes/telegram-v1-note'
  const note = { id: 'telegram-v1-note', title: 'Imported note', description: 'Original text', user: { id: 'migration-owner' } }
  const batch = writeBatch(owner)
  batch.set(doc(owner, path), note)
  batch.set(doc(owner, `${path}/revisions/telegram-v1`), { snapshot: note, user: { id: 'migration-owner' } })
  await assertSucceeds(batch.commit())
  assert.deepEqual((await getDoc(doc(owner, `${path}/revisions/telegram-v1`))).data().snapshot, (await getDoc(doc(owner, path))).data())
  await assertFails(getDoc(doc(db('other-reader'), `${path}/revisions/telegram-v1`)))
})

test('top-level study revisions preserve signed-in reading and existing/incoming ownership checks', async () => {
  const owner = db('revision-owner'), other = db('other-reader')
  const path = 'studies/shared-revision-parent/revisions/initial'
  await assertSucceeds(setDoc(doc(owner, path), { user: { id: 'revision-owner' }, title: 'Shared revision' }))
  await assertSucceeds(getDoc(doc(other, path)))
  await assertFails(getDoc(doc(db(), path)))
  await assertFails(setDoc(doc(other, path), { user: { id: 'other-reader' }, title: 'Takeover' }))
  await assertFails(updateDoc(doc(owner, path), { 'user.id': 'other-reader' }))
  await assertSucceeds(updateDoc(doc(owner, path), { title: 'Owner correction' }))
  await assertFails(deleteDoc(doc(other, path)))
  await assertFails(deleteDoc(doc(db(), path)))
  await assertSucceeds(deleteDoc(doc(owner, path)))
  assert.equal((await getDoc(doc(owner, path))).exists(), false)
})

test('readers can only see published announcements and cannot edit editorial collections', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    const store = context.firestore()
    await setDoc(doc(store, 'events/public'), { status: 'published', lang: 'en' })
    await setDoc(doc(store, 'events/draft'), { status: 'draft', lang: 'en' })
    await setDoc(doc(store, 'plans/reading'), { title: 'Reading fixture' })
  })
  await assertSucceeds(getDocs(query(collection(db(), 'events'), where('status', '==', 'published'), where('lang', '==', 'en'))))
  await assertFails(getDocs(collection(db('alice'), 'events')))
  await assertFails(getDoc(doc(db('alice'), 'events/draft')))
  for (const path of ['events/public', 'plans/reading', 'commentaries-FR/injected', 'changelog/injected']) {
    await assertFails(setDoc(doc(db('alice'), path), { title: 'Client edit' }))
  }
  await assertSucceeds(getDoc(doc(db(), 'plans/reading')))
})
