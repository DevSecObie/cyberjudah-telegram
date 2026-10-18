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

test("a request opens one issue for the class, titled from the transcript, and later asks update its count", async () => {
  const { syncRequestIssue, issueText } = await import("../src/request-issues.ts");
  const env = { SUBS: kv(), PRIVACY_KEY: "test-key", CYBERJUDAH_TOKEN: "t" };
  const calls = [];
  const fetcher = async (url, init) => { calls.push({ url, method: init.method, body: JSON.parse(init.body) }); return new Response(JSON.stringify({ number: 77 }), { status: 201 }); };
  await requestNotes(env, A, 1, "<script>whatever the reader typed @everyone</script>");
  const cls = { title: "Day of Atonement", date: "2026-10-05" };
  assert.equal(await syncRequestIssue(env, await getRequest(env, A), cls, fetcher), 77);
  assert.equal(calls[0].method, "POST");
  assert.match(calls[0].url, /\/repos\/DevSecObie\/cyberjudah\/issues$/);
  assert.deepEqual(calls[0].body.labels, ["notes-request"]);
  assert.equal(calls[0].body.title, "Notes request: Day of Atonement");
  assert.doesNotMatch(calls[0].body.body, /script|everyone/, "nothing the reader typed is published");
  assert.match(calls[0].body.body, /<!-- notes-request:abcdefghijk -->/);
  const kept = await getRequest(env, A);
  assert.equal(kept.issue, 77);
  assert.deepEqual((await listRequests(env)).map((r) => [r.video, r.count]), [[A, 1]], "the list still reads the request");
  for (let u = 2; u <= 5; u++) await requestNotes(env, A, u, "");
  assert.equal(await syncRequestIssue(env, await getRequest(env, A), cls, fetcher), 77);
  assert.equal(calls[1].method, "PATCH");
  assert.match(calls[1].url, /\/issues\/77$/);
  assert.match(calls[1].body.body, /- Asks: 5/);
  assert.equal(issueText(A, { title: "", date: "" }, 1).title, `Notes request: ${A}`);
});

test("without a token, or when GitHub refuses, the request is kept and no issue is recorded", async () => {
  const { syncRequestIssue } = await import("../src/request-issues.ts");
  const env = { SUBS: kv(), PRIVACY_KEY: "test-key" };
  await requestNotes(env, A, 1, "");
  let called = false;
  assert.equal(await syncRequestIssue(env, await getRequest(env, A), { title: "X", date: "" }, async () => { called = true; return new Response("", { status: 201 }); }), null);
  assert.equal(called, false);
  env.CYBERJUDAH_TOKEN = "t";
  assert.equal(await syncRequestIssue(env, await getRequest(env, A), { title: "X", date: "" }, async () => new Response("", { status: 403 })), null);
  assert.equal((await getRequest(env, A)).issue, undefined);
  assert.equal((await getRequest(env, A)).count, 1);
});
