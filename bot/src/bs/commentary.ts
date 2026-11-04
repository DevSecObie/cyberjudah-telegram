import { Hono } from 'hono';
import { type App, type Ctx, type Concordance, type Note, COLLECTION, TEACHER_COLLECTIONS, isCollection, BOOKS, bookById, collection, html, integer, invalid, load, metadata, missing, numbers, paragraphs, passageLink, sha, siteLink, teacherRank, verseKey, youtube } from './core';

type Section = { id: string; rangeStartVerse: number; rangeEndVerse: number; content: string; excerpt: string };
type Notes = { url: string; videoId?: string | null }[];
export const commentaries = new Hono<App>();
const seconds = (ts: string) => /^\d+(?::\d{1,2}){1,2}$/.test(ts) ? ts.split(':').reduce((n, part) => n * 60 + Number(part), 0) : undefined;
function citation(note: Note, ts: string, video?: string | null, t?: number) {
  return `<p>${siteLink(note.url, note.label)}${note.date ? ` · ${html(note.date)}` : ''}${note.teacher ? ` · ${html(note.teacher)}` : ''} ${youtube(video, t, ts || 'Watch this moment')}</p>`;
}
export function makeSections(comments: Record<string, string[]>, book: number, chapter: number, resourceId = COLLECTION): Section[] {
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
    const base = `${resourceId}-en-${book}-${chapter}-${r.start}-${r.end}`, occurrence = (ids.get(base) ?? 0) + 1;
    ids.set(base, occurrence);
    // Decode only the entities we ourselves escape. Index excerpts contain no markup.
    const excerpt = r.content.replace(/<[^>]*>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim().slice(0, 160).trimEnd();
    return { id: occurrence === 1 ? base : `${base}-${occurrence}`, rangeStartVerse: r.start, rangeEndVerse: r.end, content: r.content, excerpt };
  });
}
// A Bishop's commentary holds only the entries the class data files under his name; 'cyberjudah'
// (every teacher) still answers for builds that ask for it.
async function reading(c: Ctx, book: number, chapter: number, resourceId = COLLECTION) {
  const row = bookById(book), teacher = TEACHER_COLLECTIONS[resourceId];
  if (chapter === 0) return { resource: { kind: 'commentary' as const, resourceId, language: 'en' as const, revision: 'cj-commentary-v1-no-introductions' }, comments: {} as Record<string, string[]>, sections: [] as Section[] };
  if (!metadata.chaptersByBook[book]?.includes(chapter)) return missing('SUPPLEMENTARY_CONTENT_NOT_FOUND');
  const data = await load<Concordance>(c, `/api/concordance/${row.slug}/${chapter}.json`);
  const notes = data.precepts?.length ? await load<Notes>(c, '/api/notes/index.json') : [];
  const items: { verses: number[]; teacher: string; date: string; content: string }[] = [];
  // As a Bible Strong commentary reads: one section per class passage, headed by the scripture,
  // each verse's teaching in verse order with the precepts the class lined up under it, then
  // the class it came from. A verse used as the precept for another scripture stands alone.
  const passages = new Map<string, { note: Note; ts: string; video?: string | null; t?: number; label: string; verses: Map<number, { points: string[]; precepts: string[] }> }>();
  const passage = (note: Note, ts: string, label: string) => {
    const key = `${note.url}|${ts}|${note.teacher}`;
    let row = passages.get(key);
    if (!row) passages.set(key, row = { note, ts, label, verses: new Map() });
    if (!row.label) row.label = label;
    return row;
  };
  const at = (row: { verses: Map<number, { points: string[]; precepts: string[] }> }, v: number) => {
    let cell = row.verses.get(v);
    if (!cell) row.verses.set(v, cell = { points: [], precepts: [] });
    return cell;
  };
  for (const p of data.commentary ?? []) {
    const row = passage(p.note, p.ts, p.passage);
    row.video ??= p.video; row.t ??= p.t;
    const v = numbers(p.verses)[0];
    if (v) at(row, v).points.push(...p.points);
  }
  for (const p of data.precepts ?? []) {
    const moment = (data.moments ?? []).find(m => m.url === p.note.url && m.ts === p.ts);
    const video = moment?.video ?? notes.find(n => n.url === p.note.url)?.videoId;
    if (p.kind === 'opened') {
      const content = `<h3>Precept for ${passageLink(p.ref)}</h3>${paragraphs(p.why || p.text)}${citation(p.note, p.ts, video, seconds(p.ts) ?? moment?.t)}`;
      items.push({ verses: numbers(p.verses), teacher: p.note.teacher, date: p.note.date, content });
      continue;
    }
    const row = passage(p.note, p.ts, '');
    row.video ??= video; row.t ??= seconds(p.ts) ?? moment?.t;
    const v = numbers(p.verses)[0];
    if (v) at(row, v).precepts.push(`<p><b>Precept</b> ${passageLink(p.ref)}</p>${paragraphs(p.why || p.text)}`);
  }
  for (const row of passages.values()) {
    const verses = [...row.verses.keys()].sort((a, b) => a - b);
    if (!verses.length) continue;
    const heading = row.label || `${bookById(book).name} ${chapter}:${verses[0]}${verses.length > 1 ? `-${verses[verses.length - 1]}` : ''}`;
    const body = verses.map(v => {
      const cell = row.verses.get(v)!;
      const points = cell.points.map((point, i) => {
        const lemma = /^([^.?!]{3,100}?):\s+(.+)$/s.exec(point);
        const text = lemma ? `<i>${html(lemma[1])}:</i> ${html(lemma[2])}` : html(point);
        return `<p>${i === 0 && verses.length > 1 ? `<b>${v}</b> ` : ''}${text}</p>`;
      }).join('');
      const label = !cell.points.length && verses.length > 1 ? `<p><b>${v}</b></p>` : '';
      return label + points + cell.precepts.join('');
    }).join('');
    const content = `<h3>${html(heading)}</h3>${body}${citation(row.note, row.ts, row.video, row.t)}`;
    const span = [];
    for (let v = verses[0]; v <= verses[verses.length - 1]; v++) span.push(v);
    items.push({ verses: span, teacher: row.note.teacher, date: row.note.date, content });
  }
  if (teacher) items.splice(0, items.length, ...items.filter(item => item.teacher === teacher));
  items.sort((a, b) => teacherRank(a.teacher) - teacherRank(b.teacher) || (b.date || '').localeCompare(a.date || ''));
  const comments: Record<string, string[]> = {};
  for (const item of items) for (const verse of item.verses) {
    const parts = comments[verse] ??= [];
    if (!parts.includes(item.content)) parts.push(item.content);
  }
  const resource = { kind: 'commentary' as const, resourceId, language: 'en' as const, revision: `cj-commentary-v1-${await sha(comments)}` };
  return { resource, comments, sections: makeSections(comments, book, chapter, resourceId) };
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
  for (const selected of data.resources) {
    if (!isCollection(selected.resourceId) || selected.language !== 'en') { unavailable.push({ ...selected, cause: 'not-found' }); continue; }
    try {
      const got = await reading(c, book, chapter, selected.resourceId);
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
  if (!isCollection(data.resourceId) || data.language !== 'en') return missing('SUPPLEMENTARY_CONTENT_NOT_FOUND');
  const got = await reading(c, book, chapter, data.resourceId);
  if (data.revision !== got.resource.revision) return missing('SUPPLEMENTARY_CONTENT_NOT_FOUND', 'The commentary revision changed; reload the reading index');
  const section = got.sections.find(s => s.id === data.sectionId);
  if (!section) return missing('SUPPLEMENTARY_CONTENT_NOT_FOUND');
  const { excerpt, ...detail } = section;
  return c.json({ resource: got.resource, book, chapter, section: detail });
});
commentaries.get('/:collection/:language/coverage', async c => {
  const resourceId = collection(c), teacher = TEACHER_COLLECTIONS[resourceId];
  const index = teacher
    ? Object.entries((await load<Record<string, Record<string, number[]>>>(c, '/api/concordance/teachers.json'))[teacher] ?? {}).map(([slug, cited]) => ({ slug, cited }))
    : await load<{ slug: string; cited: number[] }[]>(c, '/api/concordance/index.json');
  const chaptersByBook: Record<string, number[]> = {};
  for (const row of index) {
    const book = BOOKS.find(b => b.slug === row.slug);
    if (book && row.cited.length) chaptersByBook[book.id] = [...row.cited].sort((a, b) => a - b);
  }
  const books = Object.keys(chaptersByBook).map(Number).sort((a, b) => a - b);
  return c.json({ resource: { kind: 'commentary', resourceId, language: 'en', revision: `cj-commentary-coverage-${await sha(index)}` }, books, chaptersByBook });
});
commentaries.get('/:collection/:language/chapters/:book/:chapter', async c => {
  const resourceId = collection(c);
  const book = bookById(c.req.param('book')).id, chapter = integer(c.req.param('chapter'), 0, 200), got = await reading(c, book, chapter, resourceId);
  return c.json({ resource: got.resource, book, chapter, serializedComments: JSON.stringify(got.comments) });
});
commentaries.get('/:collection/:language/verses/:verseKey', async c => {
  const resourceId = collection(c);
  const ref = verseKey(c.req.param('verseKey'), true), got = await reading(c, ref.book.id, ref.chapter, resourceId);
  return c.json({ resource: got.resource, verseKey: c.req.param('verseKey'), content: (got.comments[ref.verse] ?? []).join('<hr>') });
});
