import { test } from "node:test";
import assert from "node:assert/strict";
import { migratePrivacy } from "../src/privacy-migrate.ts";
import { open, pid } from "../src/privacy.mjs";
import { moveLegacy } from "../src/chats.ts";

/** KV as Workers has it, in memory, with list and metadata. */
const kv = () => {
  const m = new Map();
  return {
    m,
    get: async (k, t) => (m.has(k) ? (t === "json" ? JSON.parse(m.get(k).v) : m.get(k).v) : null),
    getWithMetadata: async (k) => ({ value: m.get(k)?.v ?? null, metadata: m.get(k)?.meta ?? null }),
    put: async (k, v, o) => { m.set(k, { v, meta: o?.metadata ?? null }); },
    delete: async (k) => { m.delete(k); },
    list: async ({ prefix }) => ({ keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
  };
};
/** D1 with the rows given, by table; enough of the API for the migration. */
const d1 = (rows) => ({
  prepare: (sql) => ({
    bind: (...a) => ({
      all: async () => { const t = /FROM (\w+)/.exec(sql)[1]; return { results: [...new Set((rows[t] ?? []).filter((r) => /^\d+$/.test(r)))].map((user_id) => ({ user_id })) }; },
      run: async () => { const t = /(?:UPDATE OR IGNORE|DELETE FROM) (\w+)/.exec(sql)[1]; if (sql.startsWith("UPDATE")) rows[t] = rows[t].map((r) => (r === a[1] ? a[0] : r)); else rows[t] = rows[t].filter((r) => r !== a[0]); return { meta: {} }; },
    }),
  }),
});

test("privacy: every record still under a Telegram ID moves to the pseudonymous ID, then the job marks itself done", async () => {
  const env = { PRIVACY_KEY: "test-key", SUBS: kv(), DB: null };
  const rows = { accounts: ["111", "pidalready_xxxxxxxxxxx"], payments: ["111", "deleted"], usage_people: ["222"] };
  env.DB = d1(rows);
  await env.SUBS.put("sub:333", JSON.stringify({ chatId: 333, hour: 8, tz: 0 }));
  await env.SUBS.put("chats:444", JSON.stringify([{ id: "abc12345", title: "Old", updated: "x", count: 1 }]));
  await env.SUBS.put("chat:444:abc12345", JSON.stringify({ id: "abc12345", title: "Old", created: "x", updated: "x", turns: [{ role: "user", content: "Why keep the Passover?" }] }));
  await env.SUBS.put("notereq:AAAAAAAAAAA", JSON.stringify({ video: "AAAAAAAAAAA", users: [555, "already"] }), { metadata: { title: "T", count: 2 } });

  const first = await migratePrivacy(env, moveLegacy);
  assert.ok(first.moved >= 5 && !first.done);
  assert.deepEqual(rows.accounts, [await pid(env, 111), "pidalready_xxxxxxxxxxx"]);
  assert.deepEqual(rows.payments, [await pid(env, 111), "deleted"]);
  assert.deepEqual(rows.usage_people, [await pid(env, 222)]);
  const keys = [...env.SUBS.m.keys()];
  for (const id of ["333", "444", "555"]) assert.ok(!keys.some((k) => k.includes(id)), `no key under ${id}`);
  const subKey = `sub:${await pid(env, 333)}`;
  assert.ok(!(await env.SUBS.get(subKey)).includes("333"), "the subscription is sealed at rest");
  assert.equal((await open(env, subKey, await env.SUBS.get(subKey))).chatId, 333, "the chat the bot sends to is kept, inside the sealed record");
  assert.ok(!env.SUBS.m.get(`chat:${await pid(env, 444)}:abc12345`).v.includes("Passover"), "moved conversations are sealed");
  const req = await env.SUBS.getWithMetadata("notereq:AAAAAAAAAAA");
  assert.deepEqual(JSON.parse(req.value).users, [await pid(env, 555), "already"]);
  assert.deepEqual(req.metadata, { title: "T", count: 2 }, "the list's metadata is kept");

  assert.deepEqual(await migratePrivacy(env, moveLegacy), { moved: 0, done: true });
  assert.ok(await env.SUBS.get("privacy:migrated:v1"));
  assert.deepEqual(await migratePrivacy(env, moveLegacy), { moved: 0, done: true }, "and does nothing after");
});
