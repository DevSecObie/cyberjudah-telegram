import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

// The route with its sign-in, Telegram link and transcript lookups stood in for.
const out = new URL("./.build/app-requests.mjs", import.meta.url).pathname;
await build({ stdin: { contents: 'export * from "./src/app-requests.ts"; export { getRequest } from "./src/requests.ts"; export { tellersOf } from "./src/requests.ts"; export { pid } from "./src/privacy.mjs";', resolveDir: new URL("..", import.meta.url).pathname, loader: "ts" }, bundle: true, format: "esm", platform: "node", packages: "external", outfile: out, logLevel: "error", plugins: [{ name: "fixtures", setup(b) {
  b.onResolve({ filter: /^\.\/(app-identity|account-links|teachings|health)$/ }, (a) => (a.importer.endsWith("app-requests.ts") ? { path: a.path.slice(2), namespace: "fixture" } : undefined));
  b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({ loader: "js", contents: {
    "app-identity": `export async function appReader(req) { const a = req.headers.get("authorization"); return a === "Bearer alice" ? { uid: "fb-alice", name: "Alice Walker" } : a === "Bearer tom" ? { uid: "fb-tom", name: "Tom" } : null }`,
    "account-links": `export class IdentityError extends Error {} export async function linkedTelegram(env, uid) { return uid === "fb-tom" ? 42 : null }`,
    teachings: `export async function loadTranscript() { return null }`,
    health: `export async function tellAdmins(env, text) { (env.told ??= []).push(text); return 1 }`,
  }[a.path] }));
}}] });
const { appRequests, getRequest, tellersOf, pid } = await import(out);

const kv = () => {
  const m = new Map();
  return {
    get: async (k, t) => (m.has(k) ? (t === "json" ? JSON.parse(m.get(k).v) : m.get(k).v) : null),
    put: async (k, v, o) => { m.set(k, { v, meta: o?.metadata }); },
    delete: async (k) => { m.delete(k); },
    list: async ({ prefix }) => ({ keys: [...m.entries()].filter(([k]) => k.startsWith(prefix)).map(([name, e]) => ({ name, metadata: e.meta })), list_complete: true }),
  };
};
const A = "abcdefghijk";
const pending = [];
const ctx = { waitUntil: (p) => { pending.push(p); }, passThroughOnException: () => {} };
const call = (env, method, path, who, body) => appRequests.request(`https://x.test${path}`, { method, headers: { authorization: `Bearer ${who}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }, env, ctx);

test("only a signed-in app reader can ask", async () => {
  const env = { SUBS: kv(), PRIVACY_KEY: "k" };
  assert.equal((await call(env, "POST", `/${A}`, "nobody", { title: "X" })).status, 401);
  assert.equal(await getRequest(env, A), null);
});

test("an app reader asks once, is told in the app, and their first name only is kept", async () => {
  const env = { SUBS: kv(), PRIVACY_KEY: "k" };
  const r1 = await (await call(env, "POST", `/${A}`, "alice", { title: "The Nativity", tell: true })).json();
  assert.deepEqual(r1, { ok: true, count: 1, mine: true, added: true, tell: true });
  await Promise.all(pending);
  assert.equal(env.told.length, 1, "the admins hear of the first ask");
  assert.deepEqual(await (await call(env, "GET", `/${A}`, "alice")).json(), { ok: true, count: 1, mine: true, tell: true });
  const [t] = await tellersOf(env, await getRequest(env, A));
  assert.deepEqual({ name: t.name, via: t.via, chat: t.chat }, { name: "Alice", via: "app", chat: undefined });
});

test("a reader linked to Telegram counts as the same reader in both apps", async () => {
  const env = { SUBS: kv(), PRIVACY_KEY: "k" };
  await call(env, "POST", `/${A}`, "tom", { title: "X" });
  const r = await getRequest(env, A);
  assert.deepEqual(r.users, [await pid(env, 42)]);
});

test("account deletion takes the reader's ask, name and waiting notes out", async () => {
  const env = { SUBS: kv(), PRIVACY_KEY: "k" };
  await call(env, "POST", `/${A}`, "alice", { title: "X", tell: true });
  await call(env, "POST", `/${A}`, "tom", { title: "X" });
  assert.deepEqual(await (await call(env, "DELETE", "/", "alice")).json(), { ok: true, removed: 1 });
  const r = await getRequest(env, A);
  assert.equal(r.count, 1);
  assert.deepEqual(await tellersOf(env, r), []);
  assert.deepEqual(await (await call(env, "GET", "/ready", "alice")).json(), { ok: true, ready: [] });
});
