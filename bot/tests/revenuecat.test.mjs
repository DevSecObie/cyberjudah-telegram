import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { DatabaseSync } from "node:sqlite";

// revenuecat.ts reaches the balance store, which imports without file extensions (as Workers bundles it).
const out = new URL("./.build/revenuecat.mjs", import.meta.url).pathname;
await build({ stdin: { contents: 'export * from "./src/revenuecat.ts"; export { wallet } from "./src/credits.ts";', resolveDir: new URL("..", import.meta.url).pathname, loader: "ts" }, bundle: true, format: "esm", platform: "node", packages: "external", outfile: out, logLevel: "error" });
const { applyEvent, packs, purchaseIdOf, appOwner, revenuecat, wallet } = await import(out);

/** A D1 close enough for the balance store, backed by real SQLite, so its CHECK and UNIQUE rules are real. */
const d1 = () => {
  const db = new DatabaseSync(":memory:");
  const bound = (q, args) => ({
    run: async () => { const r = db.prepare(q).run(...args); return { meta: { changes: Number(r.changes ?? 0) } }; },
    first: async () => db.prepare(q).get(...args) ?? null,
    all: async () => ({ results: db.prepare(q).all(...args) }),
  });
  return {
    prepare: (q) => ({ bind: (...a) => bound(q, a), ...bound(q, []) }),
    batch: async (stmts) => { const r = []; db.exec("BEGIN"); try { for (const s of stmts) r.push(await s.run()); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return r; },
  };
};

const vars = { ASK_APP_PACKS: "credits_499:4.99,credits_999:9.99,credits_1999:19.99", ASK_STORE_FEE: "0.15", PRIVACY_KEY: "test-key" };
const fresh = () => ({ ...vars, DB: d1() });

test("each pack adds its price minus the store's cut; a malformed entry is never sold", () => {
  assert.deepEqual(packs(vars), [
    { id: "credits_499", usd: 4.99, credits_mc: 4_240_000 },
    { id: "credits_999", usd: 9.99, credits_mc: 8_490_000 },
    { id: "credits_1999", usd: 19.99, credits_mc: 16_990_000 },
  ]);
  assert.deepEqual(packs({ ASK_APP_PACKS: "bad id:5,x:-1,y:abc" }), []);
  assert.deepEqual(packs({}), []);
});

test("a purchase is credited once to the account RevenueCat names, and a refund takes back what is unspent", async () => {
  const env = fresh();
  const id = await purchaseIdOf(env, "firebase-alice");
  assert.match(id, /^[0-9a-f]{64}$/);
  const buy = { type: "NON_RENEWING_PURCHASE", app_user_id: id, product_id: "credits_999", transaction_id: "1000000001", store: "APP_STORE", environment: "PRODUCTION" };
  assert.equal(await applyEvent(env, buy), "credited");
  assert.equal(await applyEvent(env, buy), "already", "a delivery repeated is not credited twice");
  assert.equal((await wallet(env, appOwner(id))).total_mc, 8_490_000);
  assert.equal(await applyEvent(env, { ...buy, type: "CANCELLATION", cancel_reason: "CUSTOMER_SUPPORT" }), "refunded");
  assert.equal((await wallet(env, appOwner(id))).total_mc, 0);
});

test("unknown products, anonymous ids, other events and sandbox purchases in production are ignored", async () => {
  const env = fresh();
  const id = await purchaseIdOf(env, "firebase-bob");
  const buy = { type: "NON_RENEWING_PURCHASE", app_user_id: id, product_id: "credits_999", transaction_id: "2", store: "PLAY_STORE", environment: "PRODUCTION" };
  assert.equal(await applyEvent(env, { ...buy, product_id: "credits_free_money" }), "ignored");
  assert.equal(await applyEvent(env, { ...buy, app_user_id: "$RCAnonymousID:abc" }), "ignored");
  assert.equal(await applyEvent(env, { ...buy, type: "INITIAL_PURCHASE" }), "ignored", "nothing renews: subscriptions are not sold");
  assert.equal(await applyEvent(env, { ...buy, environment: "SANDBOX" }), "ignored");
  assert.equal(await applyEvent({ ...env, REVENUECAT_SANDBOX: "on" }, { ...buy, environment: "SANDBOX", transaction_id: "3" }), "credited", "staging counts test purchases");
});

test("the webhook needs RevenueCat's authorization header, and is closed without the secret", async () => {
  const post = (env, auth, body = { event: { type: "TEST" } }) => revenuecat.request("https://x.test/webhook", { method: "POST", headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify(body) }, env);
  assert.equal((await post(fresh(), "anything")).status, 503);
  const env = { ...fresh(), REVENUECAT_WEBHOOK_AUTH: "s3cret-header" };
  assert.equal((await post(env, "wrong")).status, 401);
  assert.equal((await post(env)).status, 401);
  const ok = await post(env, "s3cret-header");
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { ok: true, outcome: "ignored" });
  const id = await purchaseIdOf(env, "firebase-carol");
  const paid = await post(env, "s3cret-header", { event: { type: "NON_RENEWING_PURCHASE", app_user_id: id, product_id: "credits_499", transaction_id: "9", store: "APP_STORE", environment: "PRODUCTION" } });
  assert.deepEqual(await paid.json(), { ok: true, outcome: "credited" });
  assert.equal((await wallet(env, appOwner(id))).total_mc, 4_240_000);
});
