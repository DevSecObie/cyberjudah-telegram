import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { pid, seal } from "../src/privacy.mjs";

// mydata.ts reaches the chat, reminder and billing stores, which import one another without
// file extensions (as Workers bundles them), so it is bundled for Node first.
const out = new URL("./.build/mydata.mjs", import.meta.url).pathname;
await build({ stdin: { contents: 'export * from "./src/mydata.ts"; export { saveExchange } from "./src/chats.ts"; export { saveReminder, tgRid } from "./src/remind.ts"; export { requestNotes } from "./src/requests.ts";', resolveDir: new URL("..", import.meta.url).pathname, loader: "ts" }, bundle: true, format: "esm", platform: "node", packages: "external", outfile: out, logLevel: "error" });
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
const d1 = {
  prepare: (q) => ({ query: q, args: [], bind(...a) { this.args = a; return this; }, first: async () => null,
    async run() { sql.push([q, this.args]); return { meta: { changes: 0 } }; }, all: async () => ({ results: [] }) }),
  batch: async (s) => Promise.all(s.map(statement => statement.run())),
};
const reminder = { on: true, hour: 7, minute: 0, tz: "UTC", channels: { telegram: true }, chatId: 77, pushes: [], pending: [], from: "2026-10-01" };

async function reader() {
  const env = { SUBS: kv(), DB: d1, PRIVACY_KEY: "test-key", BOT_TOKEN: "1:x" };
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
});

test("Delete my data: every record about the reader goes, and other readers' are untouched", async () => {
  const env = await reader();
  const d = await deleteData(env, 77);
  assert.deepEqual({ ...d, askCredits: 0 }, { savedChats: 1, readingReminder: true, dailyVerse: true, classNoteRequests: 1, askCredits: 0, askPlanUntil: null });
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
      const target = store === "billing" ? "DELETE FROM accounts" : "DELETE FROM rate_counts";
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
  assert.deepEqual((await exportData(env, 77)).ask, { account: null, payments: [] });
});
