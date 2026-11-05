import { test, after } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { DatabaseSync } from "node:sqlite";
import { pid, seal, keyedHash } from "../src/privacy.mjs";

// mydata.ts reaches the chat, reminder and billing stores, which import one another without
// file extensions (as Workers bundles them), so it is bundled for Node first.
const out = new URL("./.build/mydata.mjs", import.meta.url).pathname;
await build({ stdin: { contents: 'export * from "./src/mydata.ts"; export { linkAccounts, linkedFirebase } from "./src/account-links.ts"; export { saveExchange } from "./src/chats.ts"; export { saveReminder, tgRid } from "./src/remind.ts"; export { requestNotes } from "./src/requests.ts"; export { adjust } from "./src/credits.ts"; export { setTopupReminder } from "./src/topup-remind.ts";', resolveDir: new URL("..", import.meta.url).pathname, loader: "ts" }, bundle: true, format: "esm", platform: "node", packages: "external", outfile: out, logLevel: "error" });
// No real Firestore service is contacted by these multi-store unit tests.
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  assert.equal(u.hostname, "127.0.0.1");
  if (u.pathname.endsWith(":commit")) return Response.json({ writeResults: JSON.parse(init.body).writes.map(() => ({})) });
  if (u.pathname.endsWith(":runQuery")) return Response.json([]);
  if (u.pathname.endsWith(":listCollectionIds")) return Response.json({ collectionIds: [] });
  if (u.search) return Response.json({ documents: [] });
  return new Response("", { status: 404 });
};
after(() => { globalThis.fetch = originalFetch; });
const { deleteData, deletionToken, exportData, useDeletionToken, saveExchange, saveReminder, tgRid, requestNotes } = await import(out);

const kv = () => {
  const m = new Map();
  return {
    m,
    get: async (k, t) => (m.has(k) ? (t === "json" ? JSON.parse(m.get(k).v) : m.get(k).v) : null),
    getWithMetadata: async (k) => ({ value: m.get(k)?.v ?? null, metadata: m.get(k)?.meta ?? null }),
    put: async (k, v, o) => { m.set(k, { v, meta: o?.metadata ?? null }); },
    delete: async (k) => { m.delete(k); },
    list: async ({ prefix }) => ({ keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name, metadata: m.get(name).meta })), list_complete: true }),
  };
};
/** D1 that accepts every statement and holds no allowance rows (the allowance is covered in billing tests). */
const sql = [];
const deletionBlocks = new Set();
const d1 = {
  prepare: (q) => ({ query: q, args: [], bind(...a) { this.args = a; return this; }, async first() { return q.startsWith("SELECT 1 AS blocked") && deletionBlocks.has(this.args[0]) ? { blocked: 1 } : null; },
    async run() { if (q.startsWith("INSERT OR IGNORE INTO account_deletion_blocks")) deletionBlocks.add(this.args[0]); sql.push([q, this.args]); return { meta: { changes: 0 } }; }, all: async () => ({ results: [] }) }),
  batch: async (s) => Promise.all(s.map(statement => statement.run())),
};
const reminder = { on: true, hour: 7, minute: 0, tz: "UTC", channels: { telegram: true }, chatId: 77, pushes: [], pending: [], from: "2026-10-01" };

async function reader() {
  deletionBlocks.clear();
  const env = { TELEGRAM_ACCOUNT_DELETION_READY: "true", FIRESTORE_EMULATOR_HOST: "127.0.0.1:8089", SUBS: kv(), DB: d1, PUBLICATION_STORE_ID: "production", PUBLICATION_ERASURE_PEER: {
    describe: async () => ({ version: 1, store: "staging" }),
    block: async identities => ({ version: 1, store: "staging", phase: "blocked", identities }),
    erase: async identities => ({ version: 1, store: "staging", phase: "deleted", identities }),
  }, PRIVACY_KEY: "test-key", BOT_TOKEN: "1:x" };
  await saveExchange(env, 77, "abc12345", "Why keep the Passover?", { content: "A memorial." });
  await saveReminder(env, await tgRid(env, 77), reminder);
  const subKey = `sub:${await pid(env, 77)}`;
  await env.SUBS.put(subKey, await seal(env, subKey, { chatId: 77, hour: 8, tz: 0 }));
  await requestNotes(env, "AAAAAAAAAAA", 77, "A class");
  await requestNotes(env, "AAAAAAAAAAA", 78, "A class");
  return env;
}

test("Download my data: everything kept about the reader, readable, in one file", async () => {
  const env = await reader();
  const d = await exportData(env, 77);
  assert.equal(d.savedChats.length, 1);
  assert.equal(d.savedChats[0].turns[0].content, "Why keep the Passover?");
  assert.equal(d.readingReminder.hour, 7);
  assert.deepEqual(d.dailyVerse, { hour: 8, tzOffsetMinutes: 0 });
  assert.deepEqual(d.classNoteRequests, ["AAAAAAAAAAA"]);
  assert.match(d.note, /stay on your device/);
  assert.equal(d.accountSync, null, "the synthetic Firestore account has no records");
});

test("Delete my data: every record about the reader goes, and other readers' are untouched", async () => {
  const env = await reader();
  const d = await deleteData(env, 77);
  assert.deepEqual(d, { savedChats: 1, readingReminder: true, dailyVerse: true, classNoteRequests: 1, askBalanceUsd: 0, topupReminder: false, accountSyncRecords: 0 });
  const me = await pid(env, 77);
  const left = [...env.SUBS.m.keys()].filter((k) => !k.startsWith("chatgone:"));
  assert.deepEqual(left, ["notereq:AAAAAAAAAAA"], "only the class request remains, for the other reader");
  const r = JSON.parse(env.SUBS.m.get("notereq:AAAAAAAAAAA").v);
  assert.deepEqual([r.count, r.users], [1, [await pid(env, 78)]]);
  assert.equal(env.SUBS.m.get("notereq:AAAAAAAAAAA").meta.count, 1);
  assert.ok(sql.some(([q, a]) => /DELETE FROM rate_counts/.test(q) && a[0] === `%:${me}:%`), "daily limits counted for the reader go too");
  const again = await exportData(env, 77);
  assert.deepEqual([again.savedChats, again.readingReminder, again.dailyVerse, again.classNoteRequests], [[], null, null, []]);
});

test("Download and Delete my data reach the Firestore marks account sync writes (docs/PRIVACY.md)", async () => {
  const env = { ...(await reader()), FIRESTORE_EMULATOR_HOST: "127.0.0.1:8089" };
  const highlightName = "projects/demo-cyberjudah/databases/(default)/documents/users/tg_77/highlights/mark1";
  let highlightDeleted = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    if (u.pathname.endsWith(":commit")) return Response.json({ writeResults: JSON.parse(init.body).writes.map(() => ({})) });
    if (u.pathname.endsWith(":batchWrite")) { highlightDeleted = true; return new Response(JSON.stringify({ writeResults: [{}], status: [{}] }), { status: 200 }); }
    if (u.pathname.endsWith(":runQuery")) return new Response(JSON.stringify([{ readTime: "2026-10-28T00:00:00Z" }]), { status: 200 });
    const marker = "/documents/";
    const path = u.pathname.slice(u.pathname.indexOf(marker) + marker.length);
    if (path === "users/tg_77/highlights" && !highlightDeleted) {
      return new Response(JSON.stringify({ documents: [{ name: highlightName, createTime: "2026-10-28T00:00:00Z", updateTime: "2026-10-28T00:00:00Z", fields: { entry: { stringValue: "1" }, value: { stringValue: "color2" } } }] }), { status: 200 });
    }
    if (path.split("/").length % 2 === 0 && !path.endsWith(":listCollectionIds")) return new Response("", { status: 404 });
    return new Response(JSON.stringify({ documents: [] }), { status: 200 });
  };
  try {
    const exported = await exportData(env, 77);
    assert.deepEqual(exported.accountSync.highlights, [{ id: "mark1", entry: "1", value: "color2" }]);
    const deleted = await deleteData(env, 77);
    assert.equal(deleted.accountSyncRecords, 1);
    assert.equal(highlightDeleted, true);
    assert.equal((await exportData(env, 77)).accountSync, null, "nothing is left to export once deleted");
  } finally { globalThis.fetch = originalFetch; }
});

test("the bot's Delete everything button works once, for the reader who asked, within ten minutes", async () => {
  const env = await reader();
  const t = await deletionToken(env, 77);
  assert.equal(await useDeletionToken(env, t, 78), false, "another reader cannot use it");
  const t2 = await deletionToken(env, 77);
  assert.equal(await useDeletionToken(env, t2, 77), true);
  assert.equal(await useDeletionToken(env, t2, 77), false, "only once");
  assert.equal(await useDeletionToken(env, "not-a-token", 77), false);
});

for (const store of ["billing", "rate counters", "legacy allowance"]) {
  test(`Delete my data: a failed ${store} deletion rejects and can be retried`, async () => {
    const env = await reader(), remove = env.SUBS.delete;
    await env.SUBS.put("acct:77", JSON.stringify({ credits: 42 }));
    const failed = new Error("storage unavailable");
    if (store === "legacy allowance") env.SUBS.delete = async k => { if (k === "acct:77") throw failed; return remove(k); };
    else env.DB = { ...d1, batch: async statements => {
      const target = store === "billing" ? "DELETE FROM credit_lots" : "DELETE FROM rate_counts";
      if (statements.some(s => s.query.startsWith(target))) throw failed;
      return d1.batch(statements);
    } };
    await assert.rejects(deleteData(env, 77), failed, "never acknowledge an incomplete deletion");
    // Earlier stores may already have been removed. Retrying must not remove a second
    // reader's request or subtract their vote again.
    env.DB = d1; env.SUBS.delete = remove;
    await deleteData(env, 77);
    assert.equal(await env.SUBS.get("acct:77"), null);
    const request = await env.SUBS.get("notereq:AAAAAAAAAAA", "json");
    assert.deepEqual([request.count, request.users], [1, [await pid(env, 78)]]);
    const after = await exportData(env, 77);
    assert.deepEqual([after.savedChats, after.readingReminder, after.dailyVerse, after.classNoteRequests], [[], null, null, []]);
  });
}

test("Download my data: a failed billing read rejects instead of exporting an incomplete copy", async () => {
  const env = await reader();
  env.DB = { ...d1, prepare: q => ({ ...d1.prepare(q), first: async () => { throw new Error("billing unavailable"); } }) };
  await assert.rejects(exportData(env, 77), /billing unavailable/);
  env.DB = d1;
  assert.deepEqual((await exportData(env, 77)).ask, { balance: { wallet: { total_mc: 0, lots: [] }, history: [] }, payments: [], donations: [] });
});

/** Execute the real statements in SQLite, including D1's all-or-nothing batches. */
async function storedReader(t, key) {
  const db = new DatabaseSync(":memory:"); t.after(() => db.close());
  let failure;
  const check = q => { if (failure?.test(q)) throw new Error("storage unavailable"); };
  const DB = {
    prepare(q) {
      return { args: [], bind(...args) { this.args = args; return this; },
        async first() { check(q); return db.prepare(q).get(...this.args) ?? null; },
        async all() { check(q); return { results: db.prepare(q).all(...this.args) }; },
        async run() { check(q); return { meta: { changes: Number(db.prepare(q).run(...this.args).changes) } }; },
      };
    },
    async batch(statements) {
      db.exec("BEGIN");
      try { const results = []; for (const s of statements) results.push(await s.run()); db.exec("COMMIT"); return results; }
      catch (e) { db.exec("ROLLBACK"); throw e; }
    },
  };
  // Each local database gets a fresh module's schema-initialization state.
  const api = await import(`${out}?store=${key}`);
  const env = { ...await reader(), DB };
  db.exec("CREATE TABLE payments (user_id TEXT, kind TEXT, stars INTEGER, created_at INTEGER); CREATE TABLE donations (charge_id TEXT, user_id TEXT, stars INTEGER, created_at INTEGER); CREATE TABLE accounts (user_id TEXT); CREATE TABLE usage_people (user_id TEXT); CREATE TABLE rate_counts (key TEXT PRIMARY KEY, n INTEGER)");
  const owners = await Promise.all([77, 78].map(uid => pid(env, uid)));
  for (const [i, owner] of owners.entries()) {
    await api.adjust(env, owner, 5_000_000, `fixture-${i}`, "Privacy test");
    await api.setTopupReminder(env, 77 + i, true, "America/Los_Angeles");
    db.prepare("INSERT INTO payments VALUES (?, 'pack', 385, 1)").run(owner);
    db.prepare("INSERT INTO donations VALUES (?, ?, 50, 1)").run(`gift-${i}`, owner);
    db.prepare("INSERT INTO accounts VALUES (?)").run(owner);
    db.prepare("INSERT INTO usage_people VALUES (?)").run(owner);
    db.prepare("INSERT INTO credit_meta VALUES (?, 1)").run(owner);
    db.prepare("INSERT INTO credit_holds VALUES (?, ?, 0, '[]', 'held', 'fixture-model', 1)").run(`hold-${i}`, owner);
    db.prepare("INSERT INTO credit_usage (request_id, user_id, at, status, held_mc, charged_mc, cost_usd) VALUES (?, ?, 1, 'ok', 0, 0, 0)").run(`usage-${i}`, owner);
    db.prepare("INSERT INTO rate_counts VALUES (?, 1)").run(`ask:${owner}:2026-10-03`);
  }
  return { api, env, db, owners, fail: pattern => { failure = pattern; } };
}

for (const [store, pattern] of [
  ["credit history", /^DELETE FROM credit_usage/],
  ["payment identity", /^UPDATE payments/],
  ["legacy account", /^DELETE FROM accounts/],
  ["top-up reminder", /^DELETE FROM topup_reminders/],
]) {
  test(`Delete my data: ${store} failure remains visible and retry clears only that reader`, async t => {
    const { api, env, db, owners: [me, other], fail } = await storedReader(t, store);
    const otherBefore = await api.exportData(env, 78);
    fail(pattern);
    await assert.rejects(api.deleteData(env, 77), /storage unavailable/);
    fail();
    await api.deleteData(env, 77);
    for (const table of ["credit_lots", "credit_ledger", "credit_holds", "credit_usage", "credit_meta", "accounts", "usage_people", "topup_reminders"]) {
      assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`).get(me).n, 0, table);
      assert.ok(db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`).get(other).n > 0, `other reader's ${table}`);
    }
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM payments WHERE user_id = ?").get(me).n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM payments WHERE user_id = 'deleted'").get().n, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM donations WHERE user_id = ?").get(me).n, 0, "donation unlinked, not deleted");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM donations WHERE user_id = 'deleted'").get().n, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM donations WHERE user_id = ?").get(other).n, 1, "other reader's gift untouched");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM rate_counts WHERE key LIKE ?").get(`%:${me}:%`).n, 0);
    const after = await api.exportData(env, 77), otherAfter = await api.exportData(env, 78);
    assert.equal(after.ask.balance.wallet.total_mc, 0);
    assert.deepEqual(after.ask.donations, []);
    assert.deepEqual(after.askTopupReminder, { on: false, tz: null });
    assert.deepEqual(otherAfter.ask, otherBefore.ask);
    assert.deepEqual(otherAfter.askTopupReminder, otherBefore.askTopupReminder);
    const request = await env.SUBS.get("notereq:AAAAAAAAAAA", "json");
    assert.deepEqual([request.count, request.users], [1, [other]]);
  });
}

test("Delete my data: a missing old payments table does not block real cleanup", async t => {
  const { api, env, db } = await storedReader(t, "missing-payments");
  db.exec("DROP TABLE payments");
  const deleted = await api.deleteData(env, 77);
  assert.equal(deleted.askBalanceUsd, 5);
  assert.equal(deleted.topupReminder, true);
  assert.deepEqual((await api.exportData(env, 77)).ask.payments, []);
});

test("Delete my data: a missing old donations table does not block real cleanup", async t => {
  const { api, env, db } = await storedReader(t, "missing-donations");
  db.exec("DROP TABLE donations");
  const deleted = await api.deleteData(env, 77);
  assert.equal(deleted.askBalanceUsd, 5);
  assert.equal(deleted.topupReminder, true);
  assert.deepEqual((await api.exportData(env, 77)).ask.donations, []);
});

test("Download my data: a failed top-up reminder read rejects rather than omitting it", async t => {
  const { api, env, fail } = await storedReader(t, "export-topup");
  fail(/^SELECT tz FROM topup_reminders/);
  await assert.rejects(api.exportData(env, 77), /storage unavailable/);
  fail();
  assert.deepEqual((await api.exportData(env, 77)).askTopupReminder, { on: true, tz: "America/Los_Angeles" });
});

for (const unavailable of [undefined, "false", "TRUE", "missing-firestore"]) {
  test(`Delete my data: readiness ${unavailable} preserves every store and does not report success`, async () => {
    const env = await reader();
    if (unavailable === "missing-firestore") delete env.FIRESTORE_EMULATOR_HOST;
    else env.TELEGRAM_ACCOUNT_DELETION_READY = unavailable;
    const before = [...env.SUBS.m], sqlBefore = sql.length;
    await assert.rejects(deleteData(env, 77), /account_deletion_not_ready/);
    assert.deepEqual([...env.SUBS.m], before, "no KV deletion, session revocation or link loss");
    assert.equal(sql.length, sqlBefore, "no database mutations before readiness");
  });
}

test("Delete my data: incomplete Firestore cleanup retains the verified link for a later retry", async t => {
  const { api, env } = await storedReader(t, "firestore-link-retry");
  await api.linkAccounts(env, 77, "verified-login");
  const fetchBefore = globalThis.fetch;
  globalThis.fetch = async (url, init) => String(url).endsWith(":commit") ? Response.json({ writeResults: JSON.parse(init.body).writes.map(() => ({})) }) : new Response("", { status: 503 });
  try {
    await assert.rejects(api.deleteData(env, 77), /Firestore read failed/);
    assert.equal(await api.linkedFirebase(env, 77), "verified-login");
  } finally { globalThis.fetch = fetchBefore; }
  await api.deleteData(env, 77);
  assert.equal(await api.linkedFirebase(env, 77), null);
});

test("Telegram/browser data deletion removes canonical and legacy publications, retaining barriers and link on failure", async t => {
  const { api, env, db, fail } = await storedReader(t, "all-channel-publications");
  await api.linkAccounts(env, 77, "verified-login");
  db.exec("CREATE TABLE published_studies (id TEXT PRIMARY KEY, owner TEXT NOT NULL, title TEXT NOT NULL, author TEXT NOT NULL, body TEXT NOT NULL, updated TEXT NOT NULL)");
  for (const uid of ["tg_77", "verified-login", "someone-else"]) {
    db.prepare("INSERT INTO published_studies VALUES (?,?,'title','author','body','now')").run(uid, await keyedHash(env, "published-study", uid));
  }
  fail(/^DELETE FROM published_studies/);
  await assert.rejects(api.deleteData(env, 77), /storage unavailable/);
  assert.equal(await api.linkedFirebase(env, 77), "verified-login");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM published_studies").get().n, 3);
  fail();
  await api.deleteData(env, 77);
  assert.deepEqual(db.prepare("SELECT id FROM published_studies").all().map(row => row.id), ["someone-else"]);
  assert.deepEqual(db.prepare("SELECT firebase_uid FROM account_deletion_blocks ORDER BY firebase_uid").all().map(row => row.firebase_uid), ["tg_77", "verified-login"]);
  assert.equal(await api.linkedFirebase(env, 77), null);
});
