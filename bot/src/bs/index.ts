import { Hono } from 'hono';
import { bible } from './bible';
import { dictionaries } from './dictionary';
import { lexicon, strongBibles } from './strongs';
import { naves } from './topics';
import { commentaries } from './commentary';
import { timelines } from './timeline';
import { type App, BOOKS, FeedError, invalid, limit, load, metadata, missing, sha, verseKey } from './core';

export const bs = new Hono<App>();
bs.use('*', async (c, next) => {
  c.header('access-control-allow-origin', '*');
  c.header('x-content-type-options', 'nosniff');
  if (c.req.method === 'OPTIONS') {
    c.header('access-control-allow-methods', 'GET, POST, OPTIONS');
    c.header('access-control-allow-headers', 'content-type');
    c.header('access-control-max-age', '86400');
    return c.body(null, 204);
  }
  await next();
  // Same public TTLs as /api/dictionary; no shared caching of POST bodies or errors.
  c.header('cache-control', c.req.method === 'GET' && c.res.status === 200 ? `public, max-age=${/\/entries\/[^/]+$|\/books\/\d+\/chapters\/\d+$/.test(c.req.path) ? 86400 : 3600}` : 'no-store');
});
bs.onError((error, c) => {
  const known = error instanceof FeedError;
  const status = known ? error.status : 503;
  let code = known ? error.code : 'BIBLE_PUBLICATION_INACTIVE';
  if (status === 503) {
    const family = c.req.path.includes('/strong-lexicon/') ? 'STRONG_LEXICON' : c.req.path.includes('/strong-bibles/') ? 'STRONG_BIBLE' : c.req.path.includes('/dictionaries') ? 'DICTIONARY' : c.req.path.includes('/naves/') ? 'NAVE' : /\/(commentaries|cross-references)\//.test(c.req.path) ? 'SUPPLEMENTARY' : c.req.path.includes('/timelines/') ? 'TIMELINE' : 'BIBLE';
    code = `${family}_PUBLICATION_INACTIVE`;
    c.header('retry-after', '60');
  }
  c.header('cache-control', 'no-store');
  c.header('content-type', 'application/problem+json');
  return c.json({ _tag: status === 400 ? 'InvalidResourceRequestProblem' : status === 404 ? 'ResourceNotFoundProblem' : 'ResourceUnavailableProblem', type: `https://cyberjudah.io/bs/problems/${code.toLowerCase().replaceAll('_', '-')}`, title: status === 400 ? 'Invalid request' : status === 404 ? 'Resource not found' : 'Resource unavailable', status, code, detail: known ? error.message : 'The CyberJudah data source could not be read', requestId: crypto.randomUUID(), ...(status === 503 ? { retryAfterSeconds: 60 } : {}) }, status);
});
bs.get('/health', c => c.json({ status: 'ok' }));
bs.route('/v1/bibles', bible);
bs.route('/v1/dictionaries', dictionaries);
bs.route('/v1/strong-lexicon', lexicon);
bs.route('/v1/strong-bibles', strongBibles);
bs.route('/v1/naves', naves);
bs.route('/v1/commentaries', commentaries);
bs.get('/v1/cross-references/:language/verses/:verseKey', async c => {
  // Upstream's request schema hardcodes "fr"; the identifiers themselves are language-neutral.
  const lang = c.req.param('language');
  if (!['en', 'fr'].includes(lang)) return missing('SUPPLEMENTARY_CONTENT_NOT_FOUND');
  const ref = verseKey(c.req.param('verseKey'), true);
  if (ref.chapter && !metadata.chaptersByBook[ref.book.id]?.includes(ref.chapter)) return missing('SUPPLEMENTARY_CONTENT_NOT_FOUND');
  const data = ref.chapter ? await load<Record<string, [string, number, number][]> | null>(c, `/api/xref/${ref.book.slug}/${ref.chapter}.json`, true) : null;
  const references = [...new Set((data?.[ref.verse] ?? []).flatMap(([slug, chapter, verse]) => {
    const book = BOOKS.find(b => b.slug === slug);
    return book ? [`${book.id}-${chapter}-${verse}`] : [];
  }))];
  return c.json({ resource: { kind: 'cross-references', resourceId: 'cyberjudah-xref', language: lang, revision: `cj-xref-${await sha(data)}` }, verseKey: c.req.param('verseKey'), references });
});
bs.route('/v1/timelines', timelines);
bs.get('/v1/interlinear-bibles/:version/languages/:language/coverage', c => missing('INTERLINEAR_UNSUPPORTED'));
bs.get('/v1/interlinear-bibles/:version/languages/:language/books/:book/chapters/:chapter', c => missing('INTERLINEAR_UNSUPPORTED'));
bs.post('/v1/search-events', c => c.json({ accepted: false }, 202));
bs.all('*', c => missing('SUPPLEMENTARY_CONTENT_NOT_FOUND', 'No CyberJudah resource exists at this route'));
