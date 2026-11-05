import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { FeedError } from './bs/core';
import { readBibleStrongReference } from './bs/upstream-reference';

const publication = new Hono<{ Bindings: { REFERENCE_PUBLICATIONS: Fetcher; NAVE_LIMIT: RateLimit } }>();
const prefix = '/bs/reference';
publication.use('*', cors({ origin: '*', allowMethods: ['GET', 'OPTIONS'], allowHeaders: ['Accept', 'Content-Type', 'X-Firebase-AppCheck'] }));
publication.get(prefix + '/v1/naves/*', async c => {
  const { success } = await c.env.NAVE_LIMIT.limit({ key: c.req.header('CF-Connecting-IP') || 'unknown' });
  if (!success) return c.json({ code: 'NAVE_RATE_LIMITED' }, 429, { 'retry-after': '60', 'cache-control': 'no-store' });
  const url = new URL(c.req.url);
  url.pathname = url.pathname.slice(prefix.length);
  const response = await readBibleStrongReference(
    new Request(url),
    (input, init) => c.env.REFERENCE_PUBLICATIONS.fetch(input, init),
    'https://reference.internal',
  );
  response.headers.set('x-cyberjudah-reference-hosting', 'self-hosted');
  return response;
});
publication.onError((error, c) => {
  const status = error instanceof FeedError ? error.status : 503;
  const code = error instanceof FeedError ? error.code : 'NAVE_PUBLICATION_INACTIVE';
  c.header('cache-control', 'no-store');
  if (status === 503) c.header('retry-after', '60');
  return c.json({ status, code, detail: status === 503 ? 'Nave is temporarily unavailable' : error.message }, status);
});
export default publication;
