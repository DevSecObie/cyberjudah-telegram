import { FeedError, invalid, missing } from './core';

const origin = 'https://api.bible-strong.app';
// Both apps agree on books 1–66. Map the shared Apocrypha by identity, never by position.
const upstreamBooks = new Map([[67, 74], [69, 67], [70, 68], [72, 69], [73, 70], [74, 71], [80, 72], [81, 73]]);

/** Public Bible Strong dictionary and Nave reads only. No reader identity, cookies or service credentials leave staging. */
export async function readBibleStrongReference(request: Request, fetcher: typeof fetch = fetch): Promise<Response> {
  const incoming = new URL(request.url);
  const path = incoming.pathname.replace(/^\/bs/, '');
  if (request.method !== 'GET') return new Response(null, { status: 405, headers: { allow: 'GET' } });
  if (!/^\/v1\/(?:dictionaries|naves)(?:\/|$)/.test(path) || /%(?:2f|5c|2e)/i.test(path) || incoming.search.length > 4096) return invalid();
  const family = path.startsWith('/v1/naves/') ? 'NAVE' : 'DICTIONARY';
  const label = family === 'NAVE' ? 'Nave Thematic Bible' : 'dictionary';
  let originalVerseKey: string | undefined, unmatched = false;
  const mappedPath = path.replace(/\/verses\/(\d+)-(\d+)-(\d+)(?=\/|$)/, (_match, book, chapter, verse) => {
    originalVerseKey = `${book}-${chapter}-${verse}`;
    const id = Number(book);
    if (id < 1 || id > 81) return missing(`${family}_PASSAGE_NOT_FOUND`, 'Bible Strong has no corresponding passage for this book');
    const upstream = id <= 66 ? id : upstreamBooks.get(id);
    // A book Bible Strong lacks gets its empty answer: Genesis 1:1 is read only for the resource
    // stamp, and every list in it is emptied, so no other book's entries are ever shown.
    if (!upstream) { unmatched = true; return '/verses/1-1-1'; }
    return `/verses/${upstream}-${chapter}-${verse}`;
  });
  let response: Response;
  try {
    response = await fetcher(`${origin}${mappedPath}${incoming.search}`, {
      method: 'GET', headers: { accept: 'application/json' }, redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new FeedError(503, `${family}_PUBLICATION_INACTIVE`, `Bible Strong’s ${label} service could not be reached`);
  }
  if (!response.headers.get('content-type')?.includes('json') || response.status >= 500 || response.status >= 300 && response.status < 400) {
    throw new FeedError(503, `${family}_PUBLICATION_INACTIVE`, `Bible Strong’s ${label} service is temporarily unavailable`);
  }
  const body = await response.json() as Record<string, unknown>;
  if (originalVerseKey && typeof body.verseKey === 'string') body.verseKey = originalVerseKey;
  if (unmatched) {
    if (response.status !== 200 || typeof body.verseKey !== 'string') return missing(`${family}_PASSAGE_NOT_FOUND`, 'Bible Strong has no corresponding passage for this book');
    for (const [key, value] of Object.entries(body)) if (Array.isArray(value)) body[key] = [];
  }
  return Response.json(body, { status: response.status, headers: {
    'cache-control': response.headers.get('cache-control') ?? 'no-store',
    'x-content-type-options': 'nosniff',
    ...(response.headers.has('retry-after') ? { 'retry-after': response.headers.get('retry-after')! } : {}),
  } });
}
