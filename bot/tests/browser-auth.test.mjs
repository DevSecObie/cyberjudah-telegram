import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { DatabaseSync } from "node:sqlite";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { open } from "../src/privacy.mjs";

const out = new URL("./.build/browser-auth.mjs", import.meta.url).pathname;
await build({ stdin: { contents: 'export * from "./src/browser-auth.ts"; export * from "./src/study-backup.ts";', resolveDir: new URL("..", import.meta.url).pathname, loader: "ts" }, bundle: true, format: "esm", platform: "node", packages: "external", outfile: out, logLevel: "error" });
const { browserAuth, browserSession, revokeBrowserSessions, telegramProfile, studyBackup, readStudyBackup, deleteStudyBackup } = await import(out);
function env() {
  const db = new DatabaseSync(":memory:");
  const prepare = (sql, values = []) => ({ bind: (...a) => prepare(sql, a), first: async () => db.prepare(sql).get(...values) ?? null, run: async () => ({ meta: { changes: db.prepare(sql).run(...values).changes } }) });
  return { DB: { prepare }, PRIVACY_KEY: "test-privacy-key", BOT_TOKEN: "100:local-test", TELEGRAM_LOGIN_CLIENT_ID: "100", TELEGRAM_LOGIN_CLIENT_SECRET: "test-client-secret" };
}
const origin = "https://cyberjudah.test";
const cookie = r => r.headers.get("set-cookie").split(";")[0];
test("login is unavailable without explicit OIDC configuration", async () => {
  const e = env(); delete e.TELEGRAM_LOGIN_CLIENT_SECRET;
  assert.equal((await browserAuth.request(`${origin}/start`, {}, e)).status, 503);
  assert.deepEqual(await (await browserAuth.request(`${origin}/status`, {}, e)).json(), { available: false, user: null });
});
test("verified Telegram id, not the opaque subject or a numeric string, identifies the account", () => {
  assert.equal(telegramProfile({ sub: "opaque", id: 77, name: "Reader" }).id, 77);
  for (const id of ["77", -1, 0, Number.MAX_SAFE_INTEGER + 1, undefined]) assert.throws(() => telegramProfile({ id, name: "Reader", sub: "77" }));
});
test("OIDC state, PKCE, signed claims, nonce, cookies, CSRF and revocation protect browser sessions", async () => {
  const e = env(), { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = { ...await exportJWK(publicKey), kid: "test-key", alg: "RS256", use: "sig" };
  const start = await browserAuth.request(`${origin}/start`, {}, e);
  const url = new URL(start.headers.get("location")), loginCookie = cookie(start);
  assert.equal(url.origin, "https://oauth.telegram.org"); assert.equal(url.searchParams.get("code_challenge_method"), "S256"); assert.equal(url.searchParams.get("scope"), "openid profile");
  assert.match(start.headers.get("set-cookie"), /HttpOnly/); assert.match(start.headers.get("set-cookie"), /Secure/);
  const pending = await open(e, "browser-login", decodeURIComponent(loginCookie.split("=").slice(1).join("=")));
  let nonce = pending.nonce, exchanges = 0, audience = "100", tokenIssuer = "https://oauth.telegram.org", expiration = "5m", signingKey = privateKey;
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const target = String(input);
    if (target.endsWith("jwks.json")) return Response.json({ keys: [jwk] });
    if (target.endsWith("/token")) {
      exchanges++; assert.equal(new URLSearchParams(init.body).get("code_verifier"), pending.verifier);
      const token = await new SignJWT({ id: 77, name: "Reader", nonce }).setProtectedHeader({ alg: "RS256", kid: "test-key" }).setIssuer(tokenIssuer).setAudience(audience).setSubject("opaque-subject").setIssuedAt().setExpirationTime(expiration).sign(signingKey);
      return Response.json({ id_token: token });
    }
    throw new Error(`Unexpected network request: ${target}`);
  };
  try {
    const badState = await browserAuth.request(`${origin}/callback?code=test&state=wrong`, { headers: { cookie: loginCookie } }, e);
    assert.match(badState.headers.get("location"), /login=failed/); assert.equal(exchanges, 0);
    nonce = "wrong";
    const wrongNonce = await browserAuth.request(`${origin}/callback?code=test&state=${pending.state}`, { headers: { cookie: loginCookie } }, e);
    assert.match(wrongNonce.headers.get("location"), /login=failed/);
    nonce = pending.nonce;
    const rejected = async () => {
      const response = await browserAuth.request(`${origin}/callback?code=test&state=${pending.state}`, { headers: { cookie: loginCookie } }, e);
      assert.match(response.headers.get("location"), /login=failed/);
      assert.ok(!response.headers.getSetCookie().some(c => c.startsWith("__Host-cj-session=")), "invalid claims never create a session");
    };
    audience = "another-client"; await rejected(); audience = "100";
    tokenIssuer = "https://evil.test"; await rejected(); tokenIssuer = "https://oauth.telegram.org";
    expiration = "-5m"; await rejected(); expiration = "5m";
    signingKey = (await generateKeyPair("RS256")).privateKey; await rejected(); signingKey = privateKey;
    const success = await browserAuth.request(`${origin}/callback?code=test&state=${pending.state}`, { headers: { cookie: loginCookie } }, e);
    assert.equal(success.headers.get("location"), "/app/settings/account");
    const sessionCookie = success.headers.getSetCookie().find(c => c.startsWith("__Host-cj-session=")).split(";")[0];
    assert.equal((await browserSession(new Request(`${origin}/api/me`, { headers: { cookie: sessionCookie } }), e)).user.id, 77);
    assert.equal(await browserSession(new Request(`${origin}/api/privacy/delete`, { method: "POST", headers: { cookie: sessionCookie, origin: "https://evil.test" } }), e), null);
    assert.equal((await browserAuth.request(`${origin}/logout`, { method: "POST", headers: { cookie: sessionCookie, origin: "https://evil.test" } }, e)).status, 403);
    await revokeBrowserSessions(e, 77);
    assert.equal(await browserSession(new Request(`${origin}/api/me`, { headers: { cookie: sessionCookie } }), e), null);
  } finally { globalThis.fetch = oldFetch; }
});
test("study backup revisions prevent lost updates, are private per account, and can be deleted", async () => {
  const e = env();
  // Authentication wraps the router exactly as the Worker does; never test an unprotected live route.
  const { Hono } = await import("hono"); const app = new Hono();
  app.use("*", async (c, next) => { c.set("tma", { user: { id: 77 } }); await next(); }); app.route("/", studyBackup);
  const put = (revision, text) => app.request(`${origin}/`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ revision, archive: { app: "cyberjudah-studies", version: 1, studies: [{ version: 1, id: "cba0e889-4a93-45e2-8f07-fb1e9cc04e22", revision: 1, title: text, tags: [], created: "2026-10-08T00:00:00.000Z", updated: "2026-10-08T00:00:00.000Z", blocks: [] }], annotations: [] } }) }, e);
  assert.equal((await put(0, "First" )).status, 200);
  assert.equal((await put(0, "Stale" )).status, 409);
  assert.equal((await put(1, "Updated" )).status, 200);
  assert.equal((await put(1, "Conflict" )).status, 409);
  assert.equal((await readStudyBackup(e, 77)).archive.studies[0].title, "Updated");
  assert.equal((await readStudyBackup(e, 78)).archive, null);
  await deleteStudyBackup(e, 77);
  assert.equal((await put(2, "Deleted elsewhere" )).status, 409);
  assert.equal((await readStudyBackup(e, 77)).archive, null);
});
