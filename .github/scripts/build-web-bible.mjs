// Writes every KJV chapter (and its Strong's layer) as files into the web build, read from the
// live cyberjudah.io/bs API, so web.cyberjudah.io serves each chapter from Cloudflare's edge
// (web/src/worker.js). Usage: node build-web-bible.mjs <dist folder> [api base]
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const [dist, base = 'https://cyberjudah.io/bs'] = process.argv.slice(2)
if (!dist) throw new Error('usage: build-web-bible.mjs <dist folder> [api base]')
const out = join(dist, '_bible')

const get = async path => {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(base + path, { headers: { accept: 'application/json' } })
    if (response.ok) return response.json()
    if (attempt === 4 || response.status < 500) throw new Error(`${path} answered ${response.status}`)
    await new Promise(resolve => setTimeout(resolve, 2000 * attempt))
  }
}
const save = async (file, data) => {
  const path = join(out, file)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(data))
}
const pool = async (jobs, size = 12) => {
  let next = 0
  await Promise.all(Array.from({ length: size }, async () => {
    while (next < jobs.length) await jobs[next++]()
  }))
}

const coverage = await get('/v1/bibles/KJV/coverage')
const strongCoverage = await get('/v1/strong-bibles/KJV/coverage')
await save('coverage.json', coverage)
await save('strong-coverage.json', strongCoverage)

const jobs = []
for (const [book, chapters] of Object.entries(coverage.chaptersByBook))
  for (const chapter of chapters)
    jobs.push(async () => {
      const data = await get(`/v1/bibles/chapters?versions=KJV&book=${book}&chapter=${chapter}`)
      const one = data.chapters?.[0]
      if (data.chapters?.length !== 1 || one.book !== +book || one.chapter !== +chapter || !one.verses?.length)
        throw new Error(`KJV ${book}:${chapter} came back incomplete`)
      await save(`chapters/${book}/${chapter}.json`, data)
      await save(`chapter/${book}/${chapter}.json`, one)
    })
for (const [book, chapters] of Object.entries(strongCoverage.chaptersByBook))
  for (const chapter of chapters)
    jobs.push(async () => {
      const data = await get(`/v1/strong-bibles/KJV/books/${book}/chapters/${chapter}`)
      if (data.book !== +book || data.chapter !== +chapter) throw new Error(`Strong's ${book}:${chapter} came back wrong`)
      await save(`strong/${book}/${chapter}.json`, data)
    })
await pool(jobs)
console.log(`wrote ${jobs.length} chapter files to ${out}`)
