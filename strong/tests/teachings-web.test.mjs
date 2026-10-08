import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { resolve, extname, sep } from 'node:path'
import { chromium, expect } from '@playwright/test'

const dist = resolve(process.env.STRONG_WEB_DIST || new URL('../dist', import.meta.url).pathname)
const titles = ['Haiti: the Rise After the Ruin', 'You Are Hated And In Hell', 'The Slave Mentality Yesterday & Today: the True Diaspora', 'Blood Toucheth Blood']
const teachers = ['Bishop Nathanyel', 'Deacon Isaac', 'Deacon Eythan', 'Captain Ashan-El']
const row = (title, i) => ({ title, kind: 'class', url: `/classes/class-${i}`, date: '2026-10-03', teacher: teachers[i] || '', thumb: '', label: 'Sabbath class' })
const feed = {
  teachings: [{ ...row('Day of Atonement', 4), date: '2026-10-05' }, ...titles.map(row), { ...row('New recording', 5), url: '/watch/aaaaaaaaaaa', video: 'aaaaaaaaaaa', pending: true }],
  feedOk: true, unavailable: [],
}

test('the staged Home preserves teaching rows, pending notes and the existing class destinations', { timeout: 120_000 }, async t => {
  await stat(resolve(dist, 'index.html'))
  const server = createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://local').pathname)
    if (/^\/app\/(note|watch)\//.test(pathname)) {
      res.writeHead(200, { 'content-type': 'text/html' }).end('<main>Existing class screen</main>')
      return
    }
    const requested = resolve(dist, pathname.replace(/^\/app\/strong\/?/, ''))
    if (!requested.startsWith(dist + sep) && requested !== dist) { res.writeHead(403).end(); return }
    const file = (await stat(requested).catch(() => null))?.isFile() ? requested : resolve(dist, 'index.html')
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.ttf': 'font/ttf', '.otf': 'font/otf', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' }[extname(file)] || 'application/octet-stream'
    res.writeHead(200, { 'content-type': type })
    createReadStream(file).pipe(res)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const origin = `http://127.0.0.1:${server.address().port}`
  const browser = await chromium.launch({ channel: 'chromium' })
  t.after(() => browser.close())
  const context = await browser.newContext({ viewport: { width: 431, height: 1100 }, isMobile: true, hasTouch: true, locale: 'en-US' })
  let unavailable = false
  let returnedFeed = structuredClone(feed)
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/app/strong/_content/teachings') {
      assert.ok(url.searchParams.get('timeZone'))
      return route.fulfill({ status: unavailable ? 503 : 200, json: unavailable ? { error: 'Classes could not be loaded. Please try again.' } : returnedFeed })
    }
    // These tests exercise the class UI; no external services or reader-resource requests.
    if (url.pathname.startsWith('/bs/')) return route.fulfill({ status: 404, json: { error: 'No fixture for this resource' } })
    return url.origin === origin ? route.continue() : route.abort()
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`${origin}/app/strong/home`)
  const section = page.getByTestId('latest-teachings')
  await expect(section.getByRole('button').nth(1)).toHaveAccessibleName('Day of Atonement')
  await expect(section.getByRole('button').nth(1)).toContainText('Oct 5, 2026')
  for (let i = 0; i < titles.length; i++) {
    const button = section.getByRole('button').nth(i + 2)
    await expect(button).toHaveAccessibleName(titles[i])
    await expect(button).toContainText(`Oct 3, 2026 · ${teachers[i]}`)
    await expect(button).toContainText('Sabbath class')
  }
  await expect(section.getByText('Notes coming soon', { exact: true })).toHaveCount(1)
  await section.getByRole('button', { name: 'All classes', exact: true }).click()
  await expect(page).toHaveURL(`${origin}/app/strong/passage-media`)
  await expect(page.getByRole('button', { name: 'Day of Atonement', exact: true })).toBeVisible()
  await page.getByRole('button', { name: titles[0], exact: true }).click()
  await expect(page).toHaveURL(`${origin}/app/note/classes/class-0`)

  await page.goto(`${origin}/app/strong/passage-media`)
  await page.getByRole('button', { name: 'New recording', exact: true }).click()
  await expect(page).toHaveURL(`${origin}/app/watch/aaaaaaaaaaa`)
  returnedFeed.teachings.at(-1).pending = false
  returnedFeed.teachings.at(-1).url = '/classes/new-recording'
  await page.goto(`${origin}/app/strong/home`)
  await expect(section.getByRole('button', { name: 'New recording', exact: true })).toBeVisible()
  await expect(section.getByText('Notes coming soon', { exact: true })).toHaveCount(0)

  unavailable = true
  await page.reload()
  await expect(section.getByRole('alert')).toHaveText('Classes could not be loaded. Please try again.', { timeout: 15_000 })
  assert.deepEqual(errors, [])
})
