// Project the current, published CyberJudah timeline into Bible Strong's existing contracts.
// No drafts, upstream articles or stock artwork are imported.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { byCaptivity, captivityOf } from '../../shared/captivities.mjs';
import { flatten, hasDetails, linkedEvents } from '../../shared/timeline.mjs';

const read = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const source = await read('../../app/src/data/timeline.json');
const final = await read('../../app/src/data/final-captivity.json');
const between = await read('../../app/src/data/between-testaments.json');
const cases = await read('../data/bs-timeline-cases.json');
const books = await read('../data/bs-books.json');
const publication = await read('../data/bs-metadata.json');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sections = byCaptivity(source.sections);
const all = flatten(sections);
const image = path => `https://cyberjudah.io/api/img/${path}`;
const periodPictures = new Set(['1', '2', '4', '5', '6', '7', '8', '9', '10', '11', '12']);
const portrait = event => event.portrait ? image(`people/${event.portrait}-256.webp`) : event.leader ? image(`timeline/leaders/${event.leader}-256.webp`) : undefined;
const text = parts => parts.flat(Infinity).filter(Boolean).join('\n\n');
const bookFor = name => books.find(b => [b.name, b.sourceName, b.slug].some(n => n.toLowerCase() === name.toLowerCase()));
const unmatched = new Set();
function scripture(bookName, chapter, verses) {
  const book = bookFor(bookName);
  if (!book || !publication.chaptersByBook[book.id]?.includes(Number(chapter))) return [];
  return String(verses).split(/[,;]/).flatMap(part => {
    const m = /^\s*(\d+)(?:[-–](\d+))?\s*$/.exec(part);
    const max = publication.verseCountByBookChapter[`${book.id}-${chapter}`];
    if (!m || Number(m[1]) < 1 || Number(m[2] ?? m[1]) > max) return [];
    return [`${book.id}|${chapter}:${m[1]}${m[2] ? `-${m[2]}` : ''}`];
  });
}
function reference(ref) {
  const match = /^(.*?)\s+(\d+):(\d+(?:[-–]\d+)?(?:[,;]\s*\d+(?:[-–]\d+)?)*)$/.exec(ref);
  const chapter = /^(.*?)\s+(\d+)$/.exec(ref);
  const chapterBook = chapter && bookFor(chapter[1]);
  const result = match ? scripture(match[1], match[2], match[3]) : chapterBook ? scripture(chapter[1], chapter[2], `1-${publication.verseCountByBookChapter[`${chapterBook.id}-${chapter[2]}`]}`) : [];
  if (!result.length) unmatched.add(ref);
  return result;
}
const dates = (start, end) => start === end ? `${Math.abs(start)}${start < 0 ? ' BC' : ''}` : `${Math.abs(start)}${start < 0 ? ' BC' : ''}–${Math.abs(end)}${end < 0 ? ' BC' : ''}`;
const sourceLine = s => text([[s.title, s.author, s.publisher, s.year, s.date, s.ts].filter(Boolean).join(' — '), s.url, s.supports, s.via ? `Via: ${s.via}` : '', s.accessed ? `Accessed: ${s.accessed}` : '']);
const events = all.filter(hasDetails).map(event => {
  const section = sections[event.sectionIndex];
  const detail = event.fc ? final[event.slug] : event.btt ? between[event.slug] : undefined;
  if ((event.fc || event.btt) && !detail) throw new Error(`Missing published account: ${event.slug}`);
  const studies = (event.cases ?? []).map(c => {
    if (!cases[c.slug]) throw new Error(`Missing published case: ${c.slug}`);
    return cases[c.slug];
  });
  const reign = event.reign;
  const refs = [...new Set([
    ...studies.flatMap(c => (c.refs ?? []).flatMap(r => scripture(r.book, r.chapter, r.verses))),
    ...(detail?.scriptures ?? []).flatMap(r => reference(r.ref)),
    ...(detail?.answer ?? []).flatMap(r => reference(r.ref)),
  ])];
  const article = text([
    reign ? ['Reign', reign.label ?? `${reign.approx ? 'c. ' : ''}${reign.from}–${reign.to} BC`, reign.kingdom, reign.notes, reign.born ? `Born: ${reign.born}` : '', reign.died ? `Died: ${reign.died}` : '', reign.source ?? text([source.reigns])] : [],
    studies.flatMap(c => [c.name, c.charge, c.verdictLabel, ...(c.offenseFull ?? [c.offense]), ...(c.judgmentFull ?? [c.judgment]), `Source: https://cyberjudah.io${c.url}`]),
    detail ? [
      detail.place, detail.region, detail.date?.text,
      'Documented history', ...(detail.account ?? []),
      ...(detail.teaching?.length ? ['Quotes and sources', ...detail.teaching.map(t => text([t.teacher, t.quote, ...(t.points ?? []), sourceLine(t.source)]))] : []),
      ...(detail.scriptures?.length ? ['Scriptural application', ...detail.scriptures.map(r => `${r.ref}\n${r.why}`)] : []),
      ...(detail.answer?.length ? ['Answer', ...detail.answer.map(r => `${r.ref}\n${r.why}`)] : []),
      ...(detail.sources?.length ? ['Sources', ...detail.sources.map(sourceLine)] : []),
      // The classes are the authority (owner's direction, 2026-10-30): no source disagreements.
      detail.uncertainty ? ['Uncertainty', detail.uncertainty.replace(/\s*\(see disagreements\)/gi, '')] : [],
    ] : [],
  ]);
  const picture = portrait(event);
  return {
    id: String(event.id), slug: event.slug, title: event.title,
    description: detail?.summary ?? studies.map(c => c.summary).join('\n\n'), article,
    period: section.sectionTitle, dates: detail?.date?.text ?? dates(event.start, event.end),
    scriptures: refs,
    related: linkedEvents(sections, event.slug).filter(hasDetails).map(e => ({ slug: e.slug, title: e.title })),
    images: detail?.image ? [{ file: detail.image.src, caption: text([detail.image.caption, detail.image.credit, detail.image.license, detail.image.sourceUrl]) }] : picture ? [{ file: picture, caption: `${event.title} — CyberJudah illustration` }] : [],
    videos: [],
  };
});
const geometry = sections.map(section => {
  const captivity = captivityOf(section);
  const description = text([section.sectionTitle, section.subTitle, captivity ? [captivity.age, captivity.years, captivity.prophets.length ? `Prophets: ${captivity.prophets.join(', ')}` : '', captivity.figures.length ? `Main people: ${captivity.figures.join(', ')}` : '', captivity.note, `Source: Captivity packets, Nathanyel Ben Israel, Israel United in Christ, p. ${captivity.page}. All dates are at best approximates.`] : 'Source: Bible Strong timeline geometry; CyberJudah case studies and scripture references.']);
  return {
    id: section.id, title: section.title, titleEn: section.title,
    sectionTitle: section.sectionTitle, sectionTitleEn: section.sectionTitle,
    subTitle: section.subTitle, subTitleEn: section.subTitle,
    description, descriptionEn: description,
    image: periodPictures.has(section.id) ? image(`timeline/periods/${section.id}.webp`) : '',
    startYear: section.startYear, endYear: section.endYear, interval: section.interval, color: section.color,
    events: section.events.map(e => ({ id: e.id, slug: e.slug, title: e.title, titleEn: e.title, start: e.start, end: e.end, row: e.row, type: e.type, ...(e.approx ? { approx: true } : {}), ...(e.isFixed ? { isFixed: true } : {}), ...(portrait(e) ? { image: portrait(e) } : {}) })),
  };
});
const result = {
  revision: `cj-timeline-${hash({ geometry, events })}`,
  source: { repository: 'DevSecObie/cyberjudah-telegram', language: 'en', timelineSha256: hash(source), finalCaptivitySha256: hash(final), betweenTestamentsSha256: hash(between), caseStudiesSha256: hash(cases), reviewedThrough: source.finalCaptivity?.reviewedThrough, unlinkedReferences: [...unmatched].sort() },
  sections: geometry, events,
};
await writeFile(new URL('../data/bs-timeline.json', import.meta.url), JSON.stringify(result) + '\n');
console.log(JSON.stringify({ revision: result.revision, periods: geometry.length, events: all.length, readableEvents: events.length, unlinkedReferences: result.source.unlinkedReferences }));
