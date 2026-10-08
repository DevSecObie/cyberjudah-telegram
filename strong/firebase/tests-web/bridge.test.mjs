import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { generateKeyPair, exportPKCS8 } from 'jose'
import { expect } from '@playwright/test'
import { signInitData } from '../../../bot/src/initdata.mjs'
import { openReader } from '../../tests/web-harness.mjs'

const output = new URL('./.build/bridge.mjs', import.meta.url).pathname
await build({ entryPoints: [new URL('../../../bot/src/firebase-auth.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile: output, logLevel: 'error' })
const { firebaseAuth } = await import(output)
const BOT_TOKEN = 'local-bridge-browser-fixture'
async function bindings() {
  const { privateKey } = await generateKeyPair('RS256', { extractable: true })
  return { BOT_TOKEN, FIREBASE_AUTH_LIMIT: { limit: async () => ({ success: true }) }, FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ type: 'service_account', project_id: 'cyberjudah-app', client_email: 'fixture@cyberjudah-app.iam.gserviceaccount.com', private_key: await exportPKCS8(privateKey) }) }
}
// Read only the UID from the real SDK's persisted session. Never return token fields.
async function storedUid(page) {
  return page.evaluate(() => new Promise(resolve => {
    const request = indexedDB.open('firebaseLocalStorageDb')
    request.onerror = () => resolve(null)
    request.onsuccess = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('firebaseLocalStorage')) { db.close(); resolve(null); return }
      const read = db.transaction('firebaseLocalStorage').objectStore('firebaseLocalStorage').getAll()
      read.onsuccess = () => { resolve(read.result.find(row => row.fbase_key.startsWith('firebase:authUser:'))?.value.uid ?? null); db.close() }
      read.onerror = () => { db.close(); resolve(null) }
    }
  }))
}

test('verified Telegram launch signs in once, restores without minting, and shares the UID across devices', { timeout: 120_000 }, async t => {
  const env = await bindings()
  const initData = await signInitData({ user: { id: 123456, first_name: 'Fixture' }, auth_date: Math.floor(Date.now() / 1000) }, BOT_TOKEN)
  const counts = { token: 0, identity: 0 }
  const firebaseRequest = request => {
    const path = new URL(request.url).pathname.replace('/api/firebase', '')
    counts[path.slice(1)]++
    return firebaseAuth.request(`https://local.test${path}`, { method: request.method, headers: request.headers }, env)
  }
  const first = await openReader(t, { allowEmulators: true, telegramInitData: initData, firebaseRequest })
  await expect.poll(() => storedUid(first.page)).toBe('tg_123456')
  assert.equal(counts.token, 1)
  await first.page.reload()
  await expect.poll(() => counts.identity).toBe(1)
  assert.equal(await storedUid(first.page), 'tg_123456')
  assert.equal(counts.token, 1, 'cold start restores the SDK session; no second custom token')
  const second = await openReader(t, { allowEmulators: true, telegramInitData: initData, firebaseRequest })
  await expect.poll(() => storedUid(second.page)).toBe('tg_123456')
  assert.equal(counts.token, 2, 'one mint for each genuinely fresh device')
  assert.deepEqual(first.errors, [])
  assert.deepEqual(second.errors, [])
})

test('tampered Telegram launch fails before the browser obtains a Firebase session', { timeout: 60_000 }, async t => {
  const env = await bindings()
  const signed = await signInitData({ user: { id: 123456, first_name: 'Fixture' }, auth_date: Math.floor(Date.now() / 1000) }, BOT_TOKEN)
  let status
  const reader = await openReader(t, { allowEmulators: true, telegramInitData: signed.replace('Fixture', 'Tampered'), firebaseRequest: async request => {
    const response = await firebaseAuth.request('https://local.test/token', { method: 'POST', headers: request.headers }, env)
    status = response.status
    return response
  } })
  await expect.poll(() => status).toBe(401)
  assert.equal(await storedUid(reader.page), null)
})
