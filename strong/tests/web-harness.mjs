import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { resolve, extname, sep } from 'node:path'
import { chromium, expect } from '@playwright/test'

const dist = resolve(process.env.STRONG_WEB_DIST || new URL('../dist', import.meta.url).pathname)
const fixtures = JSON.parse(await readFile(new URL('./fixtures/reader.json', import.meta.url), 'utf8'))

export async function openReader(t, options = {}) {
  await stat(resolve(dist, 'index.html'))
  const server = createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://local').pathname)
    const requested = resolve(dist, pathname.replace(/^\/app\/strong\/?/, ''))
    if (!requested.startsWith(dist + sep) && requested !== dist) { res.writeHead(403).end(); return }
    const file = (await stat(requested).catch(() => null))?.isFile() ? requested : resolve(dist, 'index.html')
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.ttf': 'font/ttf', '.otf': 'font/otf', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' }[extname(file)] || 'application/octet-stream'
    res.writeHead(200, { 'content-type': type })
    createReadStream(file).pipe(res)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)) })
  const origin = `http://127.0.0.1:${server.address().port}`
  const browser = await chromium.launch({ channel: 'chromium' })
  t.after(() => browser.close())
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'en-US' })
  if (options.telegramInitData !== undefined) await context.addInitScript(raw => {
    window.Telegram = { WebApp: { initData: raw } }
  }, options.telegramInitData)
  await context.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.pathname.startsWith('/api/firebase/') && options.firebaseRequest) {
      const response = await options.firebaseRequest(new Request(route.request().url(), {
        method: route.request().method(), headers: route.request().headers(), body: route.request().postData(),
      }))
      return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() })
    }
    if (url.pathname.startsWith('/bs/')) {
      const data = fixtures[url.pathname + url.search]
      return route.fulfill({ status: data ? 200 : 404, json: data || { error: 'No fixture for this resource' } })
    }
    if (url.pathname.startsWith('/app/strong/_media/')) return route.fulfill({ json: { schemaVersion: 1, book: 1, chapter: 1, moments: [] } })
    return url.origin === origin || options.allowEmulators && ['http://127.0.0.1:9099', 'http://127.0.0.1:8089'].includes(url.origin) ? route.continue() : route.abort()
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  if (process.env.DEBUG_WEB_TESTS) {
    page.on('console', message => { if (message.type() === 'error' || message.type() === 'warn') console.log(message.type(), message.text()) })
    page.on('requestfailed', request => console.log('request failed', new URL(request.url()).pathname, request.failure()?.errorText))
    page.on('response', response => { if (response.url().includes(':9099') || response.url().includes(':8089')) console.log('emulator response', response.status(), new URL(response.url()).pathname) })
  }
  await page.goto(`${origin}/app/strong/`)
  await expect(page.locator('[data-verse-key="1-1-1"]')).toBeVisible({ timeout: 30_000 })
  return { context, page, errors, origin }
}
