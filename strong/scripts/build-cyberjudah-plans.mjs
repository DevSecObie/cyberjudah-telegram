import { readFile, writeFile } from 'node:fs/promises'
const root = new URL('../../', import.meta.url)
const books = JSON.parse(await readFile(new URL('bot/data/bs-books.json', root)))
const metadata = JSON.parse(await readFile(new URL('bot/data/bs-metadata.json', root)))
const definitions = [
  ['cyberjudah-four-chapters', '4 Chapters a Day', 'Read the whole King James Bible with Apocrypha in library order.', () => true, 4],
  ['cyberjudah-new-testament', 'New Testament', 'Matthew through Revelation, in book order.', b => b.id >= 40 && b.id <= 66, 4],
  ['cyberjudah-apocrypha', 'Apocrypha', 'The books included in the King James Apocrypha.', b => b.id > 66, 4],
  ['cyberjudah-psalms-proverbs', 'Psalms and Proverbs', 'Read through Psalms and Proverbs, a chapter at a time.', b => [19, 20].includes(b.id), 1],
  ['cyberjudah-law', 'The Law', 'Genesis, Exodus, Leviticus, Numbers and Deuteronomy.', b => b.id <= 5, 4],
]
// Match the existing library order: OT, Apocrypha, NT.
const ordered = [...books.filter(b => b.id < 40), ...books.filter(b => b.id > 66), ...books.filter(b => b.id >= 40 && b.id <= 66)]
const plans = definitions.map(([id, title, description, select, perDay]) => {
  const chapters = ordered.filter(select).flatMap(book => metadata.chaptersByBook[book.id].map(chapter => `${book.id}|${chapter}`))
  const days = []
  for (let offset = 0; offset < chapters.length; offset += perDay) {
    const day = offset / perDay + 1
    days.push({ id: `${id}-day-${day}`, title: `Day ${day}`, slices: chapters.slice(offset, offset + perDay).map(chapters => ({ id: `${id}-${chapters}`, type: 'Chapter', chapters })) })
  }
  return { id, title, subTitle: `${perDay} ${perDay === 1 ? 'chapter' : 'chapters'} a day`, description, kind: 'reading-plan', type: 'reading-plan', lang: 'en', duration: days.length,
    author: { id: 'cyberjudah', displayName: 'CyberJudah', photoUrl: '' },
    attribution: { text: 'King James Version with Apocrypha, published by CyberJudah.', url: 'https://cyberjudah.io' },
    sections: [{ id: `${id}-readings`, title, subTitle: '', readingSlices: days }] }
})
const output = new URL('../apps/expo/src/assets/plans/cyberjudah-plans.txt', import.meta.url)
const text = JSON.stringify(plans) + '\n'
if (process.argv.includes('--check')) {
  if (await readFile(output, 'utf8') !== text) throw new Error('CyberJudah reading plans are stale; run node strong/scripts/build-cyberjudah-plans.mjs')
} else await writeFile(output, text)
console.log(`Verified ${plans.length} plans from ${metadata.sourceCommit}; whole-library plan: ${plans[0].duration} days.`)
