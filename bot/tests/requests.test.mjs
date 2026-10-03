import { test } from "node:test";
import assert from "node:assert/strict";
import { closeRequest, getRequest, listRequests, requestNotes } from "../src/requests.ts";
import { pid } from "../src/privacy.mjs";

/** KV as Workers has it, in memory, with list and metadata. */
const kv = () => {
  const m = new Map();
  return {
    get: async (k, t) => (m.has(k) ? (t === "json" ? JSON.parse(m.get(k).v) : m.get(k).v) : null),
    put: async (k, v, o) => { m.set(k, { v, meta: o?.metadata }); },
    delete: async (k) => { m.delete(k); },
    list: async ({ prefix }) => ({ keys: [...m.entries()].filter(([k]) => k.startsWith(prefix)).map(([name, e]) => ({ name, metadata: e.meta })), list_complete: true }),
  };
};
const A = "abcdefghijk", B = "ABCDEFGHIJK";

test("a reader's ask counts once, however often they tap", async () => {
  const env = { SUBS: kv(), PRIVACY_KEY: "test-key" };
  assert.deepEqual(await requestNotes(env, A, 1, "The Kingdom Of Adam"), { count: 1, mine: true, added: true });
  assert.deepEqual(await requestNotes(env, A, 1, "The Kingdom Of Adam"), { count: 1, mine: true, added: false });
  assert.deepEqual(await requestNotes(env, A, 2, ""), { count: 2, mine: true, added: true });
  const r = await getRequest(env, A);
  assert.equal(r.title, "The Kingdom Of Adam");
  assert.deepEqual(r.users, [await pid(env, 1), await pid(env, 2)], "who asked is kept as pseudonymous IDs, not Telegram IDs");
});

test("the admins hear of a class on its first ask and at milestones, not on every ask", async () => {
  const env = { SUBS: kv(), PRIVACY_KEY: "test-key" };
  const told = [];
  for (let u = 1; u <= 6; u++) await requestNotes(env, A, u, "A class", new Date(), (r) => { told.push(r.count); });
  assert.deepEqual(told, [1, 5]);
});

test("the list puts the most asked first, then the latest; done requests leave it", async () => {
  const env = { SUBS: kv(), PRIVACY_KEY: "test-key" };
  await requestNotes(env, A, 1, "One ask", new Date("2026-01-01"));
  await requestNotes(env, B, 1, "Two asks", new Date("2026-01-01"));
  await requestNotes(env, B, 2, "Two asks", new Date("2026-01-02"));
  assert.deepEqual((await listRequests(env)).map((r) => [r.video, r.count]), [[B, 2], [A, 1]]);
  assert.equal(await closeRequest(env, B), true);
  assert.deepEqual((await listRequests(env)).map((r) => r.video), [A]);
});

test("only real YouTube ids are accepted", async () => {
  const env = { SUBS: kv(), PRIVACY_KEY: "test-key" };
  await assert.rejects(requestNotes(env, "../../x", 1, ""), /bad-video/);
  assert.equal(await getRequest(env, "nope"), null);
  assert.equal(await closeRequest(env, "nope"), false);
});

test("privacy: a request kept with Telegram IDs from before still counts each reader once, and is converted when touched", async () => {
  const env = { SUBS: kv(), PRIVACY_KEY: "test-key" };
  await env.SUBS.put("notereq:AAAAAAAAAAA", JSON.stringify({ video: "AAAAAAAAAAA", title: "Old", count: 1, users: [7], first: "x", last: "x" }));
  assert.deepEqual(await requestNotes(env, "AAAAAAAAAAA", 7, ""), { count: 1, mine: true, added: false });
  await requestNotes(env, "AAAAAAAAAAA", 8, "");
  const r = JSON.parse(await env.SUBS.get("notereq:AAAAAAAAAAA"));
  assert.deepEqual(r.users, [await pid(env, 7), await pid(env, 8)]);
});
