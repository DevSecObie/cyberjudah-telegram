import { Hono } from 'hono';
import { type App, type Ctx, type Chapter, type Concordance, type Moment, type Precept, BOOKS, bookById, collection, integer, load, metadata, missing, numbers, scriptureHref, teacherRank } from './core';

/**
 * The precepts as the app has always shown them under a verse (app/src/lib/taught.ts and
 * bible/ui/WhySheet.tsx), for Bible Strong's reader: per verse, a "Precept(s)" note that opens
 * why each is there, then each precept's scripture, then each class that read the verse.
 */
export const precepts = new Hono<App>();

type Chip = { kind: 'why'; label: string } | { kind: 'precept'; label: string; osis?: string } | { kind: 'class'; label: string; path: string };
const osisOf = (p: Precept) => scriptureHref(p.ref.url, p.ref.label)?.replace(/^bible:\/\//, '');
const seconds = (ts: string) => /^\d+(?::\d{1,2}){1,2}$/.test(ts) ? ts.split(':').reduce((n, part) => n * 60 + Number(part), 0) : 0;
/** The class's notes screen in the app, at the moment; with its recording when the chapter knows it. */
const classPath = (url: string, ts: string, moments: Moment[]) => {
  const video = moments.find(m => m.url === url)?.video;
  return `/note${url}?t=${seconds(ts)}${video ? `&video=${encodeURIComponent(video)}` : ''}`;
};
const watchPath = (m: Moment) => `/watch/${encodeURIComponent(m.video)}?t=${m.t}`;

async function concordance(c: Ctx, book: number, chapter: number) {
  if (!metadata.chaptersByBook[book]?.includes(chapter)) missing('SUPPLEMENTARY_CONTENT_NOT_FOUND');
  return (await load<Concordance>(c, `/api/concordance/${bookById(book).slug}/${chapter}.json`, true)) ?? { cited_by: [] };
}

// The chips under each verse of a chapter: the note, the precepts, then the classes.
precepts.get('/:collection/:language/precepts/:book/:chapter', async c => {
  collection(c);
  const book = bookById(c.req.param('book')).id, chapter = integer(c.req.param('chapter'), 1, 200);
  const data = await concordance(c, book, chapter);
  const verses: Record<string, Chip[]> = {};
  const seen = new Set<string>();
  for (const r of [...(data.precepts ?? [])].sort((a, b) => teacherRank(a.note.teacher) - teacherRank(b.note.teacher))) {
    const vs = numbers(r.verses ?? '');
    if (!vs.length) continue;
    const anchor = vs[vs.length - 1], key = `${anchor}|${r.ref.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    (verses[anchor] ??= []).push({ kind: 'precept', label: r.ref.label, osis: osisOf(r) });
  }
  for (const [v, chips] of Object.entries(verses)) chips.unshift({ kind: 'why', label: chips.length > 1 ? 'Precepts' : 'Precept' });
  const heard = new Set<string>();
  for (const m of [...(data.moments ?? [])].sort((a, b) => teacherRank(a.teacher ?? '') - teacherRank(b.teacher ?? '') || (b.date || '').localeCompare(a.date || ''))) {
    const vs = numbers(m.verses || '1');
    if (!vs.length || !/^[A-Za-z0-9_-]{11}$/.test(m.video ?? '')) continue;
    const anchor = vs[vs.length - 1], key = `${anchor}|${m.video}`;
    if (heard.has(key)) continue;
    heard.add(key);
    (verses[anchor] ??= []).push({ kind: 'class', label: m.label, path: watchPath(m) });
  }
  return c.json({ book, chapter, verses }, 200, { 'cache-control': 'public, max-age=3600' });
});

// The "Precept(s)" note of one verse: why each precept is there, with its words and its class.
precepts.get('/:collection/:language/precepts/:book/:chapter/:verse', async c => {
  collection(c);
  const book = bookById(c.req.param('book')), chapter = integer(c.req.param('chapter'), 1, 200), verse = integer(c.req.param('verse'), 1, 200);
  const data = await concordance(c, book.id, chapter);
  const moments = data.moments ?? [];
  const rows: Precept[] = [];
  const unique = new Set<string>();
  for (const r of data.precepts ?? []) {
    if (r.verses && !numbers(r.verses).includes(verse)) continue;
    const k = `${r.kind}|${r.ref.url}|${r.note.url}`;
    if (unique.has(k)) continue;
    unique.add(k);
    rows.push(r);
  }
  rows.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'precept' ? -1 : 1) || teacherRank(a.note.teacher) - teacherRank(b.note.teacher));
  // One line per precept: the first class's reason, the others counted.
  const lines = new Map<string, { r: Precept; more: number }>();
  for (const r of rows) {
    const k = `${r.kind}|${r.ref.url}|${r.ref.verses ?? ''}`;
    const line = lines.get(k);
    if (line) line.more++;
    else lines.set(k, { r, more: 0 });
  }
  // The precepts' own words, from the King James text.
  const chapters = new Map<string, Promise<Chapter | null>>();
  const words = async (r: Precept) => {
    const m = /^\/bible\/([a-z0-9-]+)\/(\d+)/.exec(r.ref.url);
    if (!m || !BOOKS.some(b => b.slug === m[1])) return '';
    const key = `${m[1]}/${m[2]}`;
    if (!chapters.has(key)) chapters.set(key, load<Chapter>(c, `/api/kjv/${key}.json`, true).catch(() => null));
    const text = await chapters.get(key);
    const want = new Set(numbers(r.ref.verses ?? ''));
    return text ? text.verses.filter(v => want.has(v.verse)).map(v => v.text).join(' ') : '';
  };
  const cls = (r: Precept) => ({ label: r.note.label, date: r.note.date, teacher: r.note.teacher, ts: r.ts, path: classPath(r.note.url, r.ts, moments) });
  // Until a precept has its own line, the class's point for the passage says it, once, above the precepts it covers.
  const leads = new Map<string, Precept>();
  for (const { r } of lines.values()) if (!r.why && r.point && !leads.has(r.point)) leads.set(r.point, r);
  const items = await Promise.all([...lines.values()].map(async ({ r, more }) => ({
    kind: r.kind === 'precept' ? 'precept' : 'opened', label: r.ref.label, osis: osisOf(r), words: await words(r), why: r.why ?? '', class: cls(r), more,
  })));
  return c.json({
    reference: `${book.name} ${chapter}:${verse}`,
    title: items.length > 1 ? 'Precepts' : 'Precept',
    leads: [...leads.values()].map(r => ({ point: r.point, class: cls(r) })),
    items,
  }, 200, { 'cache-control': 'public, max-age=3600' });
});
