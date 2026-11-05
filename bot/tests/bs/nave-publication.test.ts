import assert from 'node:assert/strict';
import test from 'node:test';
import publication from '../../src/nave-publication.ts';

test('the new production route maps by book identity and sends only a public read', async () => {
  const calls: string[] = [];
  const bindings = {
    REFERENCE_PUBLICATIONS: { fetch: async (input: string, init: RequestInit) => {
      calls.push(input);
      assert.deepEqual(init.headers, { accept: 'application/json' });
      return Response.json({ verseKey: '72-2-1' });
    } },
    NAVE_LIMIT: { limit: async () => ({ success: true }) },
  };
  const read = (path: string) => publication.request('https://cyberjudah.io' + path, { headers: { cookie: 'private=never-forward' } }, bindings as any);
  assert.equal((await read('/bs/v1/naves/en/topics/faith')).status, 404);
  assert.equal((await read('/bs/reference/v1/dictionaries')).status, 404);
  const result = await read('/bs/reference/v1/naves/en/verses/80-2-1/topics');
  assert.equal(result.headers.get('x-cyberjudah-reference-hosting'), 'self-hosted');
  assert.deepEqual(await result.json(), { verseKey: '80-2-1' });
  assert.deepEqual(calls, ['https://reference.internal/v1/naves/en/verses/72-2-1/topics']);
});

test('an unavailable service or exhausted rate limit never selects another publication', async () => {
  const path = '/bs/reference/v1/naves/en/topics/faith';
  let reads = 0;
  const service = { fetch: async () => { reads++; throw Error('unavailable'); } };
  for (const [success, expected] of [[false, 429], [true, 503]] as const) {
    const response = await publication.request(path, undefined, { REFERENCE_PUBLICATIONS: service, NAVE_LIMIT: { limit: async () => ({ success }) } } as any);
    assert.equal(response.status, expected);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal(reads, 2, 'one retry on the same unavailable binding');
});

test('a transient binding failure retries once and a throttled origin keeps its backoff', async () => {
  for (const [status, after, count, expected] of [[502, '', 2, 200], [503, '60', 1, 503], [429, '60', 1, 429]] as const) {
    let calls = 0;
    const service = { fetch: async () => ++calls === 1
      ? Response.json({ code: 'busy' }, { status, headers: after ? { 'retry-after': after } : {} })
      : Response.json({ topic: { name: 'Faith' } }) };
    const result = await publication.request('/bs/reference/v1/naves/en/random', undefined, {
      NAVE_LIMIT: { limit: async () => ({ success: true }) }, REFERENCE_PUBLICATIONS: service,
    } as any);
    assert.equal(result.status, expected);
    assert.equal(calls, count);
  }
});
