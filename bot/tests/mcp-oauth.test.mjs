import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

// The owner's sign-in for /mcp (mcp-oauth.ts), in the Workers runtime, walked the way claude.ai walks it.
const { outputFiles } = await build({
  stdin: {
    contents: `import { Hono } from "hono"; import { mcp } from "./src/mcp.ts"; import { mcpOAuth, mcpOAuthMetadata } from "./src/mcp-oauth.ts";
      const app = new Hono();
      app.all("/mcp", c => mcp(c.req.raw, c.env, c.executionCtx));
      app.all("/mcp/oauth/*", c => mcpOAuth(c.req.raw, c.env));
      app.on(["GET", "OPTIONS"], ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-authorization-server"], c => mcpOAuthMetadata(c.req.raw, c.env));
      export default app;`,
    resolveDir: new URL('..', import.meta.url).pathname,
  },
  bundle: true, format: 'esm', platform: 'browser', write: false, logLevel: 'error',
  loader: { '.json': 'json' },
});

const KEY = 'test-key-not-a-secret';
const HOST = 'https://cyberjudah.test';
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';

function worker(bindings = { MCP_KEY: KEY }) {
  return new Miniflare(convertV4MiniflareOptions({
    modules: true, script: outputFiles[0].text, compatibilityDate: '2026-10-01', compatibilityFlags: ['nodejs_compat'],
    bindings: { DATA_ORIGIN: 'https://data.cyberjudah.test', SITE_URL: HOST, ...bindings },
    outboundService: () => new Response('not found', { status: 404 }),
  }));
}

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const pkce = () => { const verifier = b64url(randomBytes(32)); return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) }; };
const form = (fields) => new URLSearchParams(fields).toString();
const post = (mf, path, body, headers = {}) => mf.dispatchFetch(`${HOST}${path}`, { method: 'POST', body, headers, redirect: 'manual' });
const formPost = (mf, path, fields, headers = {}) => post(mf, path, form(fields), { 'content-type': 'application/x-www-form-urlencoded', ...headers });
const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } };
const callMcp = (mf, token) => post(mf, '/mcp', JSON.stringify(init), { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18', authorization: `Bearer ${token}` });

async function registerClient(mf, redirect_uris = [CALLBACK]) {
  const r = await post(mf, '/mcp/oauth/register', JSON.stringify({ redirect_uris, client_name: 'Claude' }), { 'content-type': 'application/json' });
  return { status: r.status, body: await r.json() };
}

/** The whole sign-in: register, authorize with the key, trade the code. */
async function signIn(mf, { key = KEY, redirect = CALLBACK } = {}) {
  const { body: client } = await registerClient(mf, [redirect]);
  const { verifier, challenge } = pkce();
  const fields = { client_id: client.client_id, redirect_uri: redirect, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', state: 'xyz', resource: `${HOST}/mcp` };
  const r = await formPost(mf, '/mcp/oauth/authorize', { ...fields, key }, { origin: HOST });
  return { client, verifier, response: r };
}

test('everything stays off until the owner sets MCP_KEY', async () => {
  const mf = worker({});
  try {
    for (const path of ['/.well-known/oauth-authorization-server', '/.well-known/oauth-protected-resource/mcp', '/mcp/oauth/authorize']) {
      assert.equal((await mf.dispatchFetch(`${HOST}${path}`)).status, 404, path);
    }
  } finally { await mf.dispose(); }
});

test('a 401 from /mcp points to the metadata, and the metadata to the sign-in', async () => {
  const mf = worker();
  try {
    const r = await callMcp(mf, 'nothing');
    assert.equal(r.status, 401);
    assert.match(r.headers.get('www-authenticate'), /resource_metadata="https:\/\/cyberjudah\.test\/\.well-known\/oauth-protected-resource\/mcp"/);
    const resource = await (await mf.dispatchFetch(`${HOST}/.well-known/oauth-protected-resource/mcp`)).json();
    assert.equal(resource.resource, `${HOST}/mcp`);
    assert.deepEqual(resource.authorization_servers, [HOST]);
    const server = await (await mf.dispatchFetch(`${HOST}/.well-known/oauth-authorization-server`)).json();
    assert.equal(server.issuer, HOST);
    assert.deepEqual(server.code_challenge_methods_supported, ['S256']);
    assert.equal(server.registration_endpoint, `${HOST}/mcp/oauth/register`);
  } finally { await mf.dispose(); }
});

test('registration takes only Claude\'s callback or a loopback address', async () => {
  const mf = worker();
  try {
    assert.equal((await registerClient(mf, [CALLBACK])).status, 201);
    assert.equal((await registerClient(mf, ['http://localhost:33418/callback'])).status, 201);
    for (const bad of ['https://evil.example/cb', 'http://claude.ai/api/mcp/auth_callback', 'https://claude.ai.evil.example/api/mcp/auth_callback', 'http://user@localhost/cb']) {
      const { status, body } = await registerClient(mf, [bad]);
      assert.equal(status, 400, bad);
      assert.equal(body.error, 'invalid_redirect_uri');
    }
  } finally { await mf.dispose(); }
});

test('the owner signs in with the key, and the token reads /mcp', async () => {
  const mf = worker();
  try {
    const { client, verifier, response } = await signIn(mf);
    assert.equal(response.status, 302);
    const back = new URL(response.headers.get('location'));
    assert.equal(`${back.origin}${back.pathname}`, CALLBACK);
    assert.equal(back.searchParams.get('state'), 'xyz');
    assert.equal(back.searchParams.get('iss'), HOST);
    const code = back.searchParams.get('code');
    const t = await formPost(mf, '/mcp/oauth/token', { grant_type: 'authorization_code', code, redirect_uri: CALLBACK, client_id: client.client_id, code_verifier: verifier });
    assert.equal(t.status, 200);
    const tokens = await t.json();
    assert.equal(tokens.token_type, 'Bearer');
    assert.equal((await callMcp(mf, tokens.access_token)).status, 200);
    // A refresh gives a new working access token.
    const again = await (await formPost(mf, '/mcp/oauth/token', { grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: client.client_id })).json();
    assert.equal((await callMcp(mf, again.access_token)).status, 200);
    // Neither the refresh token nor the code is an access token.
    assert.equal((await callMcp(mf, tokens.refresh_token)).status, 401);
    assert.equal((await callMcp(mf, code)).status, 401);
  } finally { await mf.dispose(); }
});

test('a wrong key gets no code', async () => {
  const mf = worker();
  try {
    const { response } = await signIn(mf, { key: 'wrong' });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('location'), null);
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  } finally { await mf.dispose(); }
});

test('a sign-in posted from another site is refused', async () => {
  const mf = worker();
  try {
    const { response } = await (async () => {
      const { body: client } = await registerClient(mf);
      const { challenge } = pkce();
      return { response: await formPost(mf, '/mcp/oauth/authorize', { client_id: client.client_id, redirect_uri: CALLBACK, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', key: KEY }, { origin: 'https://evil.example' }) };
    })();
    assert.equal(response.status, 403);
  } finally { await mf.dispose(); }
});

test('a code needs the right verifier, client and callback', async () => {
  const mf = worker();
  try {
    const { client, verifier, response } = await signIn(mf);
    const code = new URL(response.headers.get('location')).searchParams.get('code');
    const { body: other } = await registerClient(mf);
    const tries = [
      { code, redirect_uri: CALLBACK, client_id: client.client_id, code_verifier: pkce().verifier },
      { code, redirect_uri: CALLBACK, client_id: other.client_id, code_verifier: verifier },
      { code, redirect_uri: 'https://claude.com/api/mcp/auth_callback', client_id: client.client_id, code_verifier: verifier },
      { code: `${code}x`, redirect_uri: CALLBACK, client_id: client.client_id, code_verifier: verifier },
    ];
    for (const fields of tries) {
      const r = await formPost(mf, '/mcp/oauth/token', { grant_type: 'authorization_code', ...fields });
      assert.equal(r.status, 400, JSON.stringify(fields).slice(0, 80));
      assert.equal((await r.json()).error, 'invalid_grant');
    }
  } finally { await mf.dispose(); }
});

test('the authorize page refuses an unregistered callback or a missing PKCE', async () => {
  const mf = worker();
  try {
    const { body: client } = await registerClient(mf);
    const { challenge } = pkce();
    const base = { client_id: client.client_id, redirect_uri: CALLBACK, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256' };
    assert.equal((await mf.dispatchFetch(`${HOST}/mcp/oauth/authorize?${form(base)}`)).status, 200);
    for (const bad of [{ redirect_uri: 'https://claude.com/api/mcp/auth_callback' }, { code_challenge_method: 'plain' }, { client_id: 'forged.token' }, { resource: 'https://other.test/mcp' }]) {
      const r = await mf.dispatchFetch(`${HOST}/mcp/oauth/authorize?${form({ ...base, ...bad })}`, { redirect: 'manual' });
      assert.equal(r.status, 400, JSON.stringify(bad));
    }
  } finally { await mf.dispose(); }
});

test('tokens stop working when the owner changes MCP_KEY', async () => {
  const first = worker();
  let access;
  try {
    const { client, verifier, response } = await signIn(first);
    const code = new URL(response.headers.get('location')).searchParams.get('code');
    access = (await (await formPost(first, '/mcp/oauth/token', { grant_type: 'authorization_code', code, redirect_uri: CALLBACK, client_id: client.client_id, code_verifier: verifier })).json()).access_token;
  } finally { await first.dispose(); }
  const rotated = worker({ MCP_KEY: 'a-new-key-not-a-secret' });
  try {
    assert.equal((await callMcp(rotated, access)).status, 401);
  } finally { await rotated.dispose(); }
});
