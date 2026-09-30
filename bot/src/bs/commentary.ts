import { Hono } from 'hono';
import { type App, type Ctx, type Concordance, type Note, COLLECTION, BOOKS, bookById, collection, html, integer, invalid, load, metadata, missing, numbers, paragraphs, sha, siteLink, teacherRank, verseKey, youtube } from './core';

type Section = { id: string; rangeStartVerse: number; rangeEndVerse: number; content: string; excerpt: string };
type Notes = { url: string; videoId?: string | null }[];
export const commentaries = new Hono<App>();
const seconds = (ts: string) => /^\d+(?::\d{1,2}){1,2}$/.test(ts) ? ts.split(':').reduce((n, part) => n * 60 + Number(part), 0) : undefined;
function citation(note: Note, ts: string, video?: string | null, t?: number) {
  return `<p>${siteLink(note.url, note.label)}${note.date ? ` · ${html(note.date)}` : ''}${note.teacher ? ` · ${html(note.teacher)}` : ''} ${youtube(video, t, ts || 'Watch this moment')}</p>`;
}
export function makeSections(comments: Record<string, string[]>, book: number, chapter: number): Section[] {
  const runs: { start: number; end: number; ordinal: number; content: string }[] = [];
  const byContent = new Map<string, { verse: number; ordinal: number }[]>();
  for (const [v, parts] of Object.entries(comments).sort(([a], [b]) => Number(a) - Number(b))) {
    parts.forEach((content, ordinal) => {
      const rows = byContent.get(content) ?? [];
      if (!rows.some(r => r.verse === Number(v))) rows.push({ verse: Number(v), ordinal });
      byContent.set(content, rows);
    });
  }
  for (const [content, rows] of byContent) for (let i = 0; i < rows.length;) {
    const first = rows[i]; let end = first.verse; i++;
    while (i < rows.length && rows[i].verse === end + 1) end = rows[i++].verse;
    runs.push({ start: first.verse, end, ordinal: first.ordinal, content });
  }
  runs.sort((a, b) => a.start - b.start || a.ordinal - b.ordinal || a.end - b.end);
  const ids = new Map<string, number>();
  return runs.map(r => {
    const base = `${COLLECTION}-en-${book}-${chapter}-${r.start}-${r.end}`, occurrence = (ids.get(base) ?? 0) + 1;
    ids.set(base, occurrence);
    // Decode only the entities we ourselves escape. Index excerpts contain no markup.
    const excerpt = r.content.replace(/<[^>]*>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim().slice(0, 160).trimEnd();
    return { id: occurrence === 1 ? base : `${base}-${occurrence}`, rangeStartVerse: r.start, rangeEndVerse: r.end, content: r.content, excerpt };
  });
}
async function reading(c: Ctx, book: number, chapter: number) {
  const row = bookById(book);
  if (chapter === 0) return { resource: { kind: 'commentary' as const, resourceId: COLLECTION, language: 'en' as const, revision: 'cj-commentary-v1-no-introductions' }, comments: {} as Record<string, string[]>, sections: [] as Section[] };
  if (!metadata.chaptersByBook[book]?.includes(chapter)) return missing('SUPPLEMENTARY_CONTENT_NOT_FOUND');
  const data = await load<Concordance>(c, `/api/concordance/${row.slug}/${chapter}.json`);
  const notes = data.precepts?.length ? await load<Notes>(c, '/api/notes/index.json') : [];
  const items: { verses: number[]; teacher: string; date: string; content: string }[] = [];
  for (const p of data.precepts ?? []) {
    const moment = (data.moments ?? []).find(m => m.url === p.note.url && m.ts === p.ts);
    const video = moment?.video ?? notes.find(n => n.url === p.note.url)?.videoId;
    const content = `<h3>${html(p.kind === 'opened' ? 'Read with' : 'Precept')} ${siteLink(p.ref.url, p.ref.label)}</h3>${paragraphs(p.why || p.point || p.text)}${citation(p.note, p.ts, video, seconds(p.ts) ?? moment?.t)}`;
    items.push({ verses: numbers(p.verses), teacher: p.note.teacher, date: p.note.date, content });
  }
  for (const p of data.commentary ?? []) {
    const content = `<h3>${html(p.passage)}</h3>${p.points.map(paragraphs).join('')}${citation(p.note, p.ts, p.video, p.t)}`;
    items.push({ verses: numbers(p.verses), teacher: p.note.teacher, date: p.note.date, content });
  }
  items.sort((a, b) => teacherRank(a.teacher) - teacherRank(b.teacher) || (b.date || '').localeCompare(a.date || ''));
  const comments: Record<string, string[]> = {};
  for (const item of items) for (const verse of item.verses) {
    const parts = comments[verse] ??= [];
    if (!parts.includes(item.content)) parts.push(item.content);
  }
  const resource = { kind: 'commentary' as const, resourceId: COLLECTION, language: 'en' as const, revision: `cj-commentary-v1-${await sha(comments)}` };
  return { resource, comments, sections: makeSections(comments, book, chapter) };
}
async function body(c: Ctx) {
  try {
    const text = await c.req.text();
    if (text.length > 65536) return invalid('Request body is too large');
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
    return value;
  } catch { return invalid('Expected a JSON object'); }
}
commentaries.post('/reading-index', async c => {
  const data = await body(c), book = bookById(data.book).id, chapter = integer(data.chapter, 1, 200);
  if (!Array.isArray(data.resources) || data.resources.length < 1 || data.resources.length > 5 || data.resources.some((r: { resourceId?: unknown; language?: unknown }) => !r || typeof r.resourceId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]{1,63}$/.test(r.resourceId) || !['en', 'fr'].includes(String(r.language)))) return invalid();
  const indexes = [], unavailable = [];
  let got: Awaited<ReturnType<typeof reading>> | undefined;
  for (const selected of data.resources) {
    if (selected.resourceId !== COLLECTION || selected.language !== 'en') { unavailable.push({ ...selected, cause: 'not-found' }); continue; }
    try {
      got ??= await reading(c, book, chapter);
      indexes.push({ resource: got.resource, sections: got.sections.map(({ content, ...section }) => section) });
    } catch (e) {
      if (e instanceof Error && 'status' in e && (e.status === 503 || e.status === 404)) unavailable.push({ ...selected, cause: e.status === 503 ? 'temporary-unavailable' : 'not-found' });
      else throw e;
    }
  }
  return c.json({ book, chapter, indexes, unavailable });
});
commentaries.post('/reading-section', async c => {
  const data = await body(c), book = bookById(data.book).id, chapter = integer(data.chapter, 1, 200);
  if (typeof data.resourceId !== 'string' || !['en', 'fr'].includes(data.language) || typeof data.revision !== 'string' || !data.revision || typeof data.sectionId !== 'string' || !data.sectionId) return invalid();
  if (data.resourceId !== COLLECTION || data.language !== 'en') return missing('SUPPLEMENTARY_CONTENT_NOT_FOUND');
  const got = await reading(c, book, chapter);
  if (data.revision !== got.resource.revision) return missing('SUPPLEMENTARY_CONTENT_NOT_FOUND', 'The commentary revision changed; reload the reading index');
  const section = got.sections.find(s => s.id === data.sectionId);
  if (!section) return missing('SUPPLEMENTARY_CONTENT_NOT_FOUND');
  const { excerpt, ...detail } = section;
  return c.json({ resource: got.resource, book, chapter, section: detail });
});
commentaries.get('/:collection/:language/coverage', async c => {
  collection(c);
  const index = await load<{ slug: string; cited: number[] }[]>(c, '/api/concordance/index.json');
  const chaptersByBook: Record<string, number[]> = {};
  for (const row of index) {
    const book = BOOKS.find(b => b.slug === row.slug);
    if (book && row.cited.length) chaptersByBook[book.id] = row.cited;
  }
  return c.json({ resource: { kind: 'commentary', resourceId: COLLECTION, language: 'en', revision: `cj-commentary-coverage-${await sha(index)}` }, books: Object.keys(chaptersByBook).map(Number), chaptersByBook });
});
commentaries.get('/:collection/:language/chapters/:book/:chapter', async c => {
  collection(c);
  const book = bookById(c.req.param('book')).id, chapter = integer(c.req.param('chapter'), 0, 200), got = await reading(c, book, chapter);
  return c.json({ resource: got.resource, book, chapter, serializedComments: JSON.stringify(got.comments) });
});
commentaries.get('/:collection/:language/verses/:verseKey', async c => {
  collection(c);
  const ref = verseKey(c.req.param('verseKey'), true), got = await reading(c, ref.book.id, ref.chapter);
  return c.json({ resource: got.resource, verseKey: c.req.param('verseKey'), content: (got.comments[ref.verse] ?? []).join('<hr>') });
});
