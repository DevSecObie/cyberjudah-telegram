import { Hono } from 'hono';
import { type App, type Ctx, FeedError, integer, invalid, missing } from './core';

type Manifest = { version: 1; datasetId: 'CYBERJUDAH'; textRevision: string; textSha256: string; files: Record<string, string> };
const fail = (): never => { throw new FeedError(503, 'INTERLINEAR_PUBLICATION_INACTIVE', 'The original-language publication is unavailable'); };
const hash = async (raw: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw)))].map(n => n.toString(16).padStart(2, '0')).join('');

/** Only immutable assets in this deployment, derived from catalog-verified owned archives.
 * No upstream fallback, caller-supplied origin, credentials, or client-selected asset paths. */
async function asset(c: Ctx, path: string) {
  try {
    const response = await c.env.ASSETS.fetch(new Request(`https://assets.internal/bs-data/interlinear/${path}`));
    if (!response.ok || !response.headers.get('content-type')?.includes('json')) return fail();
    return await response.text();
  } catch { return fail(); }
}

async function read(c: Ctx, path: string, kind: 'bible-text' | 'interlinear-index') {
  try {
    const manifest = JSON.parse(await asset(c, 'manifest.json')) as Manifest;
    if (manifest.version !== 1 || manifest.datasetId !== 'CYBERJUDAH' || !manifest.textRevision ||
        !/^[a-f0-9]{64}$/.test(manifest.textSha256) || !manifest.files || typeof manifest.files !== 'object') return fail();
    if (!Object.hasOwn(manifest.files, path)) return missing(kind === 'bible-text' ? 'BIBLE_CHAPTER_NOT_FOUND' : 'INTERLINEAR_CHAPTER_NOT_FOUND');
    const raw = await asset(c, path);
    if (await hash(raw) !== manifest.files[path]) return fail();
    const body = JSON.parse(raw);
    if (body.resource?.kind !== kind || body.resource.versionId !== 'BHG' || !body.resource.revision ||
        body.resource.textRevision !== manifest.textRevision || body.resource.textSha256 !== manifest.textSha256 ||
        (kind === 'interlinear-index' && (body.resource.datasetId !== 'CYBERJUDAH' || body.resource.language !== 'en'))) return fail();
    return body;
  } catch (error) {
    if (error instanceof FeedError) throw error;
    return fail();
  }
}

export async function bhgChapter(c: Ctx, book: number, chapter: number) {
  const body = await read(c, `text/${book}/${chapter}.json`, 'bible-text');
  if (body.book !== book || body.chapter !== chapter || !Array.isArray(body.verses)) return fail();
  return body;
}

export const bhgBible = new Hono<App>();
bhgBible.get('/BHG/coverage', async c => c.json(await read(c, 'text/coverage.json', 'bible-text')));
bhgBible.get('/BHG/books/:book/chapters/:chapter', async c => c.json(await bhgChapter(c,
  integer(c.req.param('book'), 1, 81), integer(c.req.param('chapter'), 1, 200))));
bhgBible.get('/BHG/pericopes', async c => {
  const { resource } = await read(c, 'text/coverage.json', 'bible-text');
  return c.json({ resource, verses: [] });
});
bhgBible.get('/BHG/verses', async c => {
  const references = c.req.query('references')?.split(',');
  if (!references?.length || references.length > 200) return invalid();
  const chapters = new Map<string, Awaited<ReturnType<typeof bhgChapter>>>();
  const verses = [];
  let resource;
  for (const key of references) {
    const match = /^([1-9]\d*)-([1-9]\d*)-(0|[1-9]\d*)$/.exec(key);
    if (!match) return invalid();
    const book = integer(match[1], 1, 81), chapter = integer(match[2], 1, 200), number = integer(match[3], 0, 200);
    const chapterKey = `${book}-${chapter}`;
    if (!chapters.has(chapterKey)) chapters.set(chapterKey, await bhgChapter(c, book, chapter));
    const data = chapters.get(chapterKey)!;
    resource = data.resource;
    const verse = data.verses.find((v: { number: number }) => v.number === number);
    if (!verse) return missing('BIBLE_VERSES_NOT_FOUND');
    verses.push({ book, chapter, number, text: verse.text });
  }
  return c.json({ resource, verses });
});

export const interlinear = new Hono<App>();
function supported(c: Ctx) {
  if (c.req.param('version') !== 'BHG' || c.req.param('language') !== 'en') return missing('INTERLINEAR_UNSUPPORTED');
}
interlinear.get('/:version/languages/:language/coverage', async c => {
  supported(c);
  return c.json(await read(c, 'en/coverage.json', 'interlinear-index'));
});
interlinear.get('/:version/languages/:language/books/:book/chapters/:chapter', async c => {
  supported(c);
  const book = integer(c.req.param('book'), 1, 81), chapter = integer(c.req.param('chapter'), 1, 200);
  const body = await read(c, `en/${book}/${chapter}.json`, 'interlinear-index');
  if (body.book !== book || body.chapter !== chapter || !Array.isArray(body.verses)) return fail();
  return c.json(body);
});
