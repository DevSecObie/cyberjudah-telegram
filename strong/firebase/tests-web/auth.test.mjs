import test from 'node:test'
import assert from 'node:assert/strict'
import { expect } from '@playwright/test'
import { openReader } from '../../tests/web-harness.mjs'

// Accounts are created only in the official Auth emulator's demo project.
const authOrigin = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1'
const password = 'emulator-only-password-2026'
async function account(email) {
  const created = await fetch(`${authOrigin}/accounts:signUp?key=local-emulator-only`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  })
  assert.equal(created.status, 200, await created.clone().text())
  const data = await created.json()
  const verified = await fetch(`${authOrigin}/accounts:update?key=local-emulator-only`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },
    body: JSON.stringify({ localId: data.localId, emailVerified: true }),
  })
  assert.equal(verified.status, 200, await verified.clone().text())
  return { email, uid: data.localId }
}
async function signIn(page, origin, account, firstSignIn = false) {
  const { email, uid } = account
  await page.goto(`${origin}/app/strong/login`)
  await page.getByPlaceholder('Email', { exact: true }).fill(email)
  await page.getByPlaceholder('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).tap()
  await expect(page).not.toHaveURL(/\/login$/, { timeout: 30_000 })
  await page.goto(`${origin}/app/strong/profile`)
  await expect(page.getByText(email, { exact: true })).toBeVisible({ timeout: 30_000 })
  // Exercise the fork's existing account upgrade instead of saving behind its modal.
  const update = page.getByRole('button', { name: 'Update now', exact: true })
  if (firstSignIn) {
    await expect(update).toBeVisible({ timeout: 30_000 })
    await update.tap()
    await expect.poll(async () => {
      // Each upstream migration can ask for confirmation; finish every presented step.
      if (await update.isVisible() && await update.isEnabled()) await update.tap()
      const response = await fetch(`http://127.0.0.1:8089/v1/projects/demo-cyberjudah/databases/(default)/documents/users/${uid}`, { headers: { authorization: 'Bearer owner' } })
      const data = await response.json()
      return data.fields?._relationsMigrated?.booleanValue
    }, { timeout: 30_000 }).toBe(true)
    await expect(page.getByTestId('account-migration-modal')).toHaveCount(0, { timeout: 30_000 })
  }
}

// A full page load closes the account write scope until the app has restored the session and
// inspected the account; edits made before then stay local and are replaced by the first cloud
// snapshot. Wait for this load's sync (its persisted state) to finish before editing.
async function accountSynced(page, since) {
  await expect.poll(() => page.evaluate(since => {
    try {
      const sync = JSON.parse(JSON.parse(localStorage.getItem('bible-strong:root') || '{}').user || '{}').sync
      return sync?.isLoading === false && sync.startedAt >= since
    } catch { return false }
  }, since), { timeout: 30_000 }).toBe(true)
}

test('real Auth and Firestore emulators sync notes across browsers and isolate account switches', { timeout: 180_000 }, async t => {
  const suffix = Date.now()
  const alice = await account(`alice-${suffix}@example.invalid`)
  const bob = await account(`bob-${suffix}@example.invalid`)
  const first = await openReader(t, { allowEmulators: true })
  await signIn(first.page, first.origin, alice, true)
  const loaded = await first.page.evaluate(() => Date.now())
  await first.page.goto(`${first.origin}/app/strong/note`)
  await accountSynced(first.page, loaded)
  await first.page.getByRole('textbox', { name: 'Title (optional)', exact: true }).fill('Private synchronized note')
  await first.page.getByRole('textbox', { name: 'Description', exact: true }).fill('Only the same account may see this note.')
  await first.page.getByRole('button', { name: 'Save', exact: true }).tap()
  await expect(first.page).toHaveURL(/\/note\?noteId=[^&]+$/)
  const noteId = new URL(first.page.url()).searchParams.get('noteId')

  // Different browser storage proves that the note came from cloud sync, not local persistence.
  const second = await openReader(t, { allowEmulators: true })
  await signIn(second.page, second.origin, alice)
  await second.page.goto(`${second.origin}/app/strong/note?noteId=${noteId}`)
  await expect(second.page.getByText('Only the same account may see this note.', { exact: true })).toBeVisible({ timeout: 30_000 })

  await first.page.goto(`${first.origin}/app/strong/profile`)
  await first.page.getByText('Sign out', { exact: true }).tap()
  await first.page.getByRole('button', { name: 'Sign out', exact: true }).tap()
  await expect(first.page).toHaveURL(/\/(login|home)$/, { timeout: 30_000 })
  await signIn(first.page, first.origin, bob, true)
  await first.page.goto(`${first.origin}/app/strong/note?noteId=${noteId}`)
  await expect(first.page.getByText('Only the same account may see this note.', { exact: true })).toHaveCount(0)
  await expect(first.page.getByText('Private synchronized note', { exact: true })).toHaveCount(0)
  assert.deepEqual(first.errors, [])
  assert.deepEqual(second.errors, [])
})
