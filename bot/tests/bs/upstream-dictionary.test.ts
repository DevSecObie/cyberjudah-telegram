import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../../src/index.ts';
import { readBibleStrongReference } from '../../src/bs/upstream-reference.ts';

test('Bible Strong dictionary reads retain source metadata and never forward account credentials', async () => {
  const body = { dictionaries: [{ resource: { work: 'easton-webster' }, title: 'Easton + Webster', attribution: 'Original attribution' }] };
  const request = new Request('https://staging.example/bs/v1/dictionaries?language=en', {
    headers: { authorization: 'Bearer must-not-leave', cookie: 'private=must-not-leave' },
  });
  const result = await readBibleStrongReference(request, async (url, options) => {
    assert.equal(url, 'https://api.bible-strong.app/v1/dictionaries?language=en');
    assert.deepEqual(options?.headers, { accept: 'application/json' });
    assert.equal(options?.redirect, 'manual');
    return Response.json(body, { headers: { 'cache-control': 'private, no-store' } });
  });
  assert.deepEqual(await result.json(), body);
  assert.equal(result.headers.get('cache-control'), 'private, no-store');
});

test('dictionary passage lookup translates Apocrypha identities and restores the caller reference', async () => {
  const response = await readBibleStrongReference(new Request('https://staging.example/bs/v1/dictionaries/verses/80-2-1/entries?language=en'), async url => {
    assert.equal(url, 'https://api.bible-strong.app/v1/dictionaries/verses/72-2-1/entries?language=en');
    return Response.json({ verseKey: '72-2-1', entries: [] });
  });
  assert.deepEqual(await response.json(), { verseKey: '80-2-1', entries: [] });
});

test('missing book mappings and non-dictionary requests never reach another upstream path', async () => {
  const unexpected: typeof fetch = async () => { throw new Error('must not fetch'); };
  for (const path of ['/bs/v1/dictionaries/verses/82-1-1/entries', '/bs/v1/offline-artifacts/private', '/bs/v1/dictionaries/%2Fadmin']) {
    await assert.rejects(readBibleStrongReference(new Request(`https://staging.example${path}`), unexpected));
  }
  assert.equal((await readBibleStrongReference(new Request('https://staging.example/bs/v1/dictionaries', { method: 'POST' }), unexpected)).status, 405);
});

test('an upstream failure is reported as unavailable, never replaced with a different dictionary', async () => {
  await assert.rejects(readBibleStrongReference(new Request('https://staging.example/bs/v1/dictionaries'), async () => new Response('Unavailable', { status: 503 })), /temporarily unavailable/);
});


test('the staging worker routes the original dictionary catalog through the public gateway', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.equal(String(url), 'https://api.bible-strong.app/v1/dictionaries?language=en');
    return Response.json({ dictionaries: [{ resource: { work: 'easton-webster' } }] });
  };
  try {
    const response = await worker.fetch(new Request('https://staging.example/bs/v1/dictionaries?language=en'), { BIBLE_STRONG_WEB: '1' } as any);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.equal((await response.json() as any).dictionaries[0].resource.work, 'easton-webster');
  } finally { globalThis.fetch = originalFetch; }
});


test('upstream redirects are rejected without following another host', async () => {
  await assert.rejects(readBibleStrongReference(new Request('https://staging.example/bs/v1/dictionaries'), async (_url, init) => {
    assert.equal(init?.redirect, 'manual');
    return new Response(null, { status: 302, headers: { location: 'https://untrusted.example' } });
  }), /temporarily unavailable/);
});


test('Nave keeps Bible Strong’s original topic description and Scripture references', async () => {
  const body = { resource: { kind: 'nave', language: 'en', revision: 'original-nave' }, topic: { name: 'Faith', normalizedName: 'faith', initial: 'F', description: '<p>Original Nave <a href="bible://Heb.11.1">Hebrews 11:1</a></p>' } };
  const response = await readBibleStrongReference(new Request('https://staging.example/bs/v1/naves/en/topics/faith'), async (url, init) => {
    assert.equal(url, 'https://api.bible-strong.app/v1/naves/en/topics/faith');
    assert.deepEqual(init?.headers, { accept: 'application/json' });
    return Response.json(body);
  });
  assert.deepEqual(await response.json(), body);
});

test('the staging worker serves original Nave rather than CyberJudah topic substitutions', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.equal(String(url), 'https://api.bible-strong.app/v1/naves/en/random');
    return Response.json({ resource: { kind: 'nave', language: 'en', revision: 'original-nave' }, topic: { name: 'Faith' } });
  };
  try {
    const response = await worker.fetch(new Request('https://staging.example/bs/v1/naves/en/random'), { BIBLE_STRONG_WEB: '1' } as any);
    assert.equal(response.status, 200);
    assert.equal((await response.json() as any).resource.revision, 'original-nave');
  } finally { globalThis.fetch = originalFetch; }
});

test('Apocrypha books Bible Strong lacks get its own empty answer, never another book', async () => {
  const seen: string[] = [];
  const upstream: typeof fetch = async url => {
    seen.push(String(url));
    if (String(url).includes('/naves/')) return Response.json({ resource: { kind: 'nave', language: 'en', revision: 'nave-en-1' }, verseKey: '1-1-1', verseTopics: [{ name: 'God' }], chapterTopics: [{ name: 'Creation' }] });
    return Response.json({ verseKey: '1-1-1', entries: [{ word: 'God' }] });
  };
  for (const book of [71, 75, 76, 77, 78, 79]) {
    const dictionary = await readBibleStrongReference(new Request(`https://staging.example/bs/v1/dictionaries/verses/${book}-1-1/entries?language=en`), upstream);
    assert.equal(dictionary.status, 200);
    assert.deepEqual(await dictionary.json(), { verseKey: `${book}-1-1`, entries: [] });
    const nave = await readBibleStrongReference(new Request(`https://staging.example/bs/v1/naves/en/verses/${book}-1-1/topics`), upstream);
    assert.deepEqual(await nave.json(), { resource: { kind: 'nave', language: 'en', revision: 'nave-en-1' }, verseKey: `${book}-1-1`, verseTopics: [], chapterTopics: [] });
  }
  assert.ok(seen.every(url => url.includes('/verses/1-1-1/')), 'an unmapped book id is never forwarded');
  await assert.rejects(readBibleStrongReference(new Request('https://staging.example/bs/v1/naves/en/verses/75-1-1/topics'), async () => Response.json({ code: 'X' }, { status: 404 })), /no corresponding passage/);
});

test("the Easton's entries withheld for church doctrine stay hidden in Bible Strong's Easton + Webster", async () => {
  const list = await readBibleStrongReference(new Request('https://staging.example/bs/v1/dictionaries/easton-webster/en/entries?limit=3'), async () =>
    Response.json({ entries: [{ id: 1, word: 'Trinity' }, { id: 2, word: 'Aaron' }, { id: 3, word: 'Incarnation' }] }));
  assert.deepEqual(await list.json(), { entries: [{ id: 2, word: 'Aaron' }] });
  await assert.rejects(readBibleStrongReference(new Request('https://staging.example/bs/v1/dictionaries/easton-webster/en/entries/trinity'), async () =>
    Response.json({ entry: { id: 7912, word: 'Trinity', definition: '<p>three distinct Persons</p>' } })), /not available/);
  const open = await readBibleStrongReference(new Request('https://staging.example/bs/v1/dictionaries/easton-webster/en/entries/aaron'), async () =>
    Response.json({ entry: { id: 1, word: 'Aaron', definition: '<p>Aaron</p>' } }));
  assert.equal((await open.json()).entry.word, 'Aaron');
});

test('staging can move Nave independently of the dictionary and reports a missing Nave binding', async () => {
  const fetchBefore = globalThis.fetch;
  const settings = { BIBLE_STRONG_WEB: '1', REFERENCE_HOSTING: 'nave-self-hosted' };
  const lookup = (path: string) => worker.fetch(new Request('https://staging.example/bs/v1/' + path), settings as any);
  const reads: string[] = [];
  globalThis.fetch = async url => {
    reads.push(String(url));
    return Response.json({ dictionaries: [{ title: 'Easton + Webster' }] });
  };
  try {
    assert.equal((await lookup('naves/en/random')).status, 503);
    const dictionary = await lookup('dictionaries?language=en');
    assert.equal(dictionary.status, 200);
    assert.equal(dictionary.headers.get('x-cyberjudah-reference-hosting'), null);
    assert.deepEqual(await dictionary.json(), { dictionaries: [{ title: 'Easton + Webster' }] });
    assert.deepEqual(reads, ['https://api.bible-strong.app/v1/dictionaries?language=en']);
  } finally { globalThis.fetch = fetchBefore; }
});

test('self-hosted editions use only the bound service for dictionaries and Nave, even without the web profile', async () => {
  const globalFetch = globalThis.fetch;
  let externalReads = 0;
  globalThis.fetch = async () => { externalReads++; throw new Error('unexpected external read'); };
  try {
    for (const family of ['dictionaries', 'naves/en']) {
      let reads = 0;
      const path = '/v1/' + family + '/verses/';
      const service = { fetch: async (url: string, init: RequestInit) => {
        reads++;
        assert.equal(url, 'https://reference.internal' + path + '72-2-1?language=en');
        assert.deepEqual(init.headers, { accept: 'application/json' });
        assert.equal(init.redirect, 'manual');
        return Response.json({ verseKey: '72-2-1', resource: { revision: 'owned-edition' } });
      } };
      const request = new Request('https://staging.example/bs' + path + '80-2-1?language=en', {
        headers: { authorization: 'Bearer private', cookie: 'private=session' },
      });
      const res = await worker.fetch(request, { REFERENCE_HOSTING: 'self-hosted', REFERENCE_PUBLICATIONS: service } as any);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('x-cyberjudah-reference-hosting'), 'self-hosted');
      assert.deepEqual(await res.json(), { verseKey: '80-2-1', resource: { revision: 'owned-edition' } });
      assert.equal(reads, 1);
    }
    for (const service of [undefined, { fetch: async () => new Response(null, { status: 503 }) }]) {
      const req = new Request('https://staging.example/bs/v1/naves/en/random');
      const res = await worker.fetch(req, { REFERENCE_HOSTING: 'self-hosted', BIBLE_STRONG_WEB: '1', REFERENCE_PUBLICATIONS: service } as any);
      assert.equal(res.status, 503);
      assert.equal((await res.json() as { code: string }).code, 'NAVE_PUBLICATION_INACTIVE');
    }
    assert.equal(externalReads, 0);
  } finally {
    globalThis.fetch = globalFetch;
  }
});
