import { FeedError, invalid, missing } from './core';

const origin = 'https://api.bible-strong.app';
// Both apps agree on books 1–66. Map the shared Apocrypha by identity, never by position.
const upstreamBooks = new Map([[67, 74], [69, 67], [70, 68], [72, 69], [73, 70], [74, 71], [80, 72], [81, 73]]);

/** Public dictionary reads only. No reader identity, cookies or service credentials leave staging. */
export async function readBibleStrongDictionary(request: Request, fetcher: typeof fetch = fetch): Promise<Response> {
  const incoming = new URL(request.url);
  const path = incoming.pathname.replace(/^\/bs/, '');
  if (request.method !== 'GET') return new Response(null, { status: 405, headers: { allow: 'GET' } });
  if (!/^\/v1\/dictionaries(?:\/|$)/.test(path) || /%(?:2f|5c|2e)/i.test(path) || incoming.search.length > 4096) return invalid();
  let originalVerseKey: string | undefined;
  const mappedPath = path.replace(/\/verses\/(\d+)-(\d+)-(\d+)(?=\/|$)/, (_match, book, chapter, verse) => {
    originalVerseKey = `${book}-${chapter}-${verse}`;
    const id = Number(book);
    const upstream = id <= 66 && id >= 1 ? id : upstreamBooks.get(id);
    if (!upstream) return missing('DICTIONARY_PASSAGE_NOT_FOUND', 'Bible Strong has no corresponding passage for this book');
    return `/verses/${upstream}-${chapter}-${verse}`;
  });
  let response: Response;
  try {
    response = await fetcher(`${origin}${mappedPath}${incoming.search}`, {
      method: 'GET', headers: { accept: 'application/json' }, redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new FeedError(503, 'DICTIONARY_PUBLICATION_INACTIVE', 'Bible Strong’s dictionary service could not be reached');
  }
  if (!response.headers.get('content-type')?.includes('json') || response.status >= 500 || response.status >= 300 && response.status < 400) {
    throw new FeedError(503, 'DICTIONARY_PUBLICATION_INACTIVE', 'Bible Strong’s dictionary service is temporarily unavailable');
  }
  const body = await response.json() as Record<string, unknown>;
  if (originalVerseKey && typeof body.verseKey === 'string') body.verseKey = originalVerseKey;
  return Response.json(body, { status: response.status, headers: {
    'cache-control': response.headers.get('cache-control') ?? 'no-store',
    'x-content-type-options': 'nosniff',
    ...(response.headers.has('retry-after') ? { 'retry-after': response.headers.get('retry-after')! } : {}),
  } });
}
