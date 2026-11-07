// web.cyberjudah.io: the app's static files, plus its resource API at /bs.
// Bible chapters are files built into each version (.github/scripts/build-web-bible.mjs), so a
// chapter is one read from Cloudflare's edge. Every other /bs request goes to the Telegram Worker
// over a service binding (no public hop), exactly as cyberjudah.io/bs answers it.
const VERSION = 'KJV'
const FILES = '/_bible'

const chapterFile = url => {
  const path = url.pathname
  if (path === '/bs/v1/bibles/chapters') {
    const q = url.searchParams
    const book = q.get('book'), chapter = q.get('chapter')
    if (q.get('versions') !== VERSION || !/^\d{1,3}$/.test(book ?? '') || !/^\d{1,3}$/.test(chapter ?? '')) return null
    if ([...q.keys()].some(key => !['versions', 'book', 'chapter'].includes(key))) return null
    return `${FILES}/chapters/${+book}/${+chapter}.json`
  }
  if (url.search) return null
  let m = path.match(/^\/bs\/v1\/bibles\/KJV\/books\/(\d{1,3})\/chapters\/(\d{1,3})$/)
  if (m) return `${FILES}/chapter/${+m[1]}/${+m[2]}.json`
  m = path.match(/^\/bs\/v1\/strong-bibles\/KJV\/books\/(\d{1,3})\/chapters\/(\d{1,3})$/)
  if (m) return `${FILES}/strong/${+m[1]}/${+m[2]}.json`
  if (path === '/bs/v1/bibles/KJV/coverage') return `${FILES}/coverage.json`
  if (path === '/bs/v1/strong-bibles/KJV/coverage') return `${FILES}/strong-coverage.json`
  return null
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/bs/')) return env.ASSETS.fetch(request)
    const file = request.method === 'GET' || request.method === 'HEAD' ? chapterFile(url) : null
    if (file) {
      const hit = await env.ASSETS.fetch(new Request(new URL(file, url), { method: request.method }))
      // A missing file comes back as the app's index.html (single-page fallback): only JSON counts.
      if (hit.ok && hit.headers.get('content-type')?.includes('application/json')) {
        const response = new Response(hit.body, hit)
        response.headers.set('content-type', 'application/json; charset=utf-8')
        response.headers.set('cache-control', 'public, max-age=3600')
        response.headers.set('access-control-allow-origin', '*')
        response.headers.set('x-content-type-options', 'nosniff')
        return response
      }
    }
    const upstream = new URL(url.pathname + url.search, 'https://cyberjudah.io')
    return env.BS.fetch(new Request(upstream, request))
  },
}
