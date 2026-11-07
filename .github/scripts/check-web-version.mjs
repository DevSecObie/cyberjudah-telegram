// Checks that a web app address serves the build in the given folder: the page names this build's
// own entry script, every script, stylesheet and preloaded font the page lists loads, and its /bs
// resource API answers.
// Usage: node check-web-version.mjs <base url> <dist folder>
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const [base, dist] = process.argv.slice(2)
if (!base || !dist) throw new Error('usage: check-web-version.mjs <base url> <dist folder>')
const origin = base.replace(/\/$/, '')
const html = await readFile(join(dist, 'index.html'), 'utf8')
const files = [...html.matchAll(/(?:src|href)="(\/[^"]+\.(?:js|css|otf|ttf|woff2))"/g)].map(m => m[1])
const entry = files.find(file => /\/entry-[^/]+\.js$/.test(file))
if (!entry) throw new Error('the built index.html names no entry script')

const check = async () => {
  for (const page of ['/home', '/privacy']) {
    const response = await fetch(origin + page, { redirect: 'follow' })
    if (!response.ok) return `${page} answered ${response.status}`
    if (!(await response.text()).includes(entry)) return `${page} is not this build (no ${entry})`
  }
  // The resource API: a chapter from this version's files, and a request passed to cyberjudah.io.
  const chapter = await fetch(`${origin}/bs/v1/bibles/chapters?versions=KJV&book=1&chapter=1`)
  if (!chapter.ok) return `the Genesis 1 chapter answered ${chapter.status}`
  if (!(await chapter.json()).chapters?.[0]?.verses?.length) return 'the Genesis 1 chapter has no verses'
  const health = await fetch(`${origin}/bs/health`)
  if (!health.ok) return `/bs/health answered ${health.status}`
  await health.arrayBuffer()
  for (const file of new Set(files)) {
    const response = await fetch(origin + file)
    await response.arrayBuffer()
    if (!response.ok) return `${file} answered ${response.status}`
  }
  return null
}

// A switch reaches every Cloudflare location within seconds; allow two minutes.
for (let attempt = 1; attempt <= 12; attempt++) {
  const problem = await check().catch(error => String(error))
  if (!problem) {
    console.log(`${origin} serves this build (${entry}, ${new Set(files).size} files checked)`)
    process.exit(0)
  }
  console.log(`attempt ${attempt}: ${problem}`)
  await new Promise(resolve => setTimeout(resolve, 10_000))
}
console.error(`::error::${origin} does not serve this build`)
process.exit(1)
