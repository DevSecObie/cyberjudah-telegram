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
  for (const path of ['/bs/v1/dictionaries/verses/79-1-1/entries', '/bs/v1/offline-artifacts/private', '/bs/v1/dictionaries/%2Fadmin']) {
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
