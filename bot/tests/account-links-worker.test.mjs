import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const { outputFiles } = await build({
  stdin: {
    contents: `import { verifyFirebaseIdentity, IdentityError } from "./src/account-links.ts";
      export default { async fetch(request) {
        try { return Response.json(await verifyFirebaseIdentity(await request.text(), true)); }
        catch (error) { return Response.json({ error: error.reason ?? 'unexpected-error' }, { status: error instanceof IdentityError ? error.status : 500 }); }
      } };`,
    resolveDir: new URL('..', import.meta.url).pathname,
  },
  bundle: true, format: 'esm', platform: 'browser', write: false, logLevel: 'error',
});
const token = provider => {
  const now = Math.floor(Date.now() / 1000);
  return [Buffer.from('{"alg":"RS256"}').toString('base64url'), Buffer.from(JSON.stringify({
    sub: 'worker-test-reader', aud: 'cyberjudah-app', iss: 'https://securetoken.google.com/cyberjudah-app',
    iat: now, exp: now + 3600, auth_time: now, firebase: { sign_in_provider: provider },
  })).toString('base64url'), 'synthetic-signature-google-is-a-local-stand-in'].join('.');
};
const worker = outboundService => new Miniflare(convertV4MiniflareOptions({
  modules: true, script: outputFiles[0].text, compatibilityDate: '2026-10-01', outboundService,
}));
const verify = (mf, value = token('google.com')) => mf.dispatchFetch('https://cyberjudah.test/verify', {
  method: 'POST', headers: { authorization: 'must-not-forward', cookie: 'private=1' }, body: value,
});

test('Google, Apple and email validation reaches Google from the real Workers runtime', async () => {
  const calls = [];
  const mf = worker(async request => {
    calls.push({ url: request.url, method: request.method, headers: request.headers, body: await request.json() });
    return Response.json({ users: [{ localId: 'worker-test-reader', validSince: '1', displayName: 'Test reader' }] });
  });
  try {
    for (const provider of ['google.com', 'apple.com', 'password']) {
      const value = token(provider), response = await verify(mf, value);
      assert.equal(response.status, 200, await response.clone().text());
      assert.equal((await response.json()).uid, 'worker-test-reader');
      assert.deepEqual(calls.at(-1).body, { idToken: value });
    }
    assert.equal(calls.length, 3);
    for (const call of calls) {
      assert.equal(new URL(call.url).origin, 'https://identitytoolkit.googleapis.com');
      assert.equal(new URL(call.url).pathname, '/v1/accounts:lookup');
      assert.equal(call.method, 'POST');
      assert.equal(call.headers.get('authorization'), null);
      assert.equal(call.headers.get('cookie'), null);
    }
  } finally { await mf.dispose(); }
});

test('Firebase verification never forwards an identity token through an upstream redirect', async () => {
  const calls = [];
  let status;
  const mf = worker(request => {
    calls.push(request.url);
    return new Response(null, { status, headers: { location: 'https://unexpected.test/collect' } });
  });
  try {
    for (status of [301, 302, 303, 307, 308]) {
      assert.equal((await verify(mf)).status, 503);
    }
    assert.equal(calls.length, 5);
    assert.ok(calls.every(url => new URL(url).origin === 'https://identitytoolkit.googleapis.com'));
  } finally { await mf.dispose(); }
});

test('Workers verification distinguishes a rejected token from an unavailable or malformed Google response', async () => {
  let upstream;
  const mf = worker(() => upstream());
  try {
    for (const status of [400, 401, 403]) {
      upstream = () => new Response('', { status });
      assert.equal((await verify(mf)).status, 401);
    }
    for (const status of [404, 429, 500, 503]) {
      upstream = () => new Response('', { status });
      assert.equal((await verify(mf)).status, 503);
    }
    upstream = () => new Response('not JSON');
    const response = await verify(mf);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, 'identity_service_unavailable');
  } finally { await mf.dispose(); }
});
