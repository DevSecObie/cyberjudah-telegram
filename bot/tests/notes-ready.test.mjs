import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createServer } from "node:http";

// notes-ready.ts reaches the bot's buttons and the Bot API client, so it is bundled for Node first.
const out = new URL("./.build/notes-ready.mjs", import.meta.url).pathname;
await build({ stdin: { contents: 'export * from "./src/notes-ready.ts"; export { requestNotes, getRequest } from "./src/requests.ts"; export { pid } from "./src/privacy.mjs";', resolveDir: new URL("..", import.meta.url).pathname, loader: "ts" }, bundle: true, format: "esm", platform: "node", packages: "external", outfile: out, logLevel: "error" });
const { deliverReadyNotes, takeReady, readyMessage, requestNotes, getRequest, pid } = await import(out);
const tg = async (env, id, name) => ({ pid: await pid(env, id), name, via: "telegram", chat: id });

const kv = () => {
  const m = new Map();
  return {
    m,
    get: async (k, t) => (m.has(k) ? (t === "json" ? JSON.parse(m.get(k).v) : m.get(k).v) : null),
    put: async (k, v, o) => { m.set(k, { v, meta: o?.metadata }); },
    delete: async (k) => { m.delete(k); },
    list: async ({ prefix }) => ({ keys: [...m.entries()].filter(([k]) => k.startsWith(prefix)).map(([name, e]) => ({ name, metadata: e.meta })), list_complete: true }),
  };
};
const A = "abcdefghijk", B = "ABCDEFGHIJK";

/** The Bot API and the data site, on loopback: records each sendMessage, answers the notes index. */
async function stand(index, blocked = new Set()) {
  const sent = [];
  const server = createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    if (req.url === "/api/notes/index.json") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(index)); return; }
    const m = /\/bot[^/]+\/sendMessage$/.exec(req.url);
    if (m) {
      const p = JSON.parse(body);
      res.setHeader("content-type", "application/json");
      if (blocked.has(p.chat_id)) { res.statusCode = 403; res.end(JSON.stringify({ ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" })); return; }
      sent.push(p); res.end(JSON.stringify({ ok: true, result: { message_id: 1, date: 0, chat: { id: p.chat_id, type: "private" } } })); return;
    }
    res.statusCode = 404; res.end("{}");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { sent, origin, close: () => server.close() };
}
const sender = { send: (f) => f() };
// The edge cache, as Workers has it: empty, so each read reaches the stand-in.
globalThis.caches ??= { default: { match: async () => undefined, put: async () => {} } };

test("a class whose notes are out: Telegram askers get one message, app askers find it on next open, the request closes", async (t) => {
  const s = await stand([{ kind: "class", title: "The Nativity", teacher: "Deacon Eythan", videoId: A, url: "/classes/x" }], new Set([3]));
  t.after(s.close);
  const env = { SUBS: kv(), PRIVACY_KEY: "k", BOT_TOKEN: "1:x", TELEGRAM_API_ROOT: s.origin, DATA_ORIGIN: s.origin, WORKER_URL: "https://app.example" };
  await requestNotes(env, A, await tg(env, 1, "David"), "The Nativity", new Date(), undefined, true);
  await requestNotes(env, A, { pid: "app-sarah", name: "Sarah", via: "app" }, "", new Date(), undefined, true);
  await requestNotes(env, A, await tg(env, 3, "Blocked"), "", new Date(), undefined, true);
  await requestNotes(env, A, 4, "");
  await requestNotes(env, B, await tg(env, 1, "David"), "Not written yet", new Date(), undefined, true);
  const run = await deliverReadyNotes(env, sender);
  assert.deepEqual({ ready: run.ready, told: run.told, failed: run.failed }, { ready: 1, told: 2, failed: 0 });
  const toDavid = s.sent.filter((m) => m.chat_id === 1);
  assert.equal(toDavid.length, 1, "told once");
  assert.equal(toDavid[0].text, readyMessage({ video: A, title: "The Nativity", teacher: "Deacon Eythan" }));
  assert.match(JSON.stringify(toDavid[0].reply_markup), /tgWebAppStartParam=watch_abcdefghijk/);
  assert.equal(await getRequest(env, A), null, "the request is closed");
  assert.ok(await getRequest(env, B), "a class still without notes stays open");
  assert.deepEqual(await takeReady(env, "app-sarah"), [{ video: A, title: "The Nativity", teacher: "Deacon Eythan" }]);
  assert.deepEqual(await takeReady(env, "app-sarah"), [], "handed over once");
  // A second run sends nothing more.
  const before = s.sent.length;
  await deliverReadyNotes(env, sender);
  assert.equal(s.sent.filter((m) => m.chat_id === 1).length, 1);
  assert.ok(s.sent.length >= before);
});

test("only class notes count as published: an index row of another kind leaves the request open", async (t) => {
  const s = await stand([{ kind: "episode", title: "Not class notes", videoId: A, url: "/episodes/x" }, { kind: "study", title: "Nor this", videoId: B, url: "/studies/x" }]);
  t.after(s.close);
  const env = { SUBS: kv(), PRIVACY_KEY: "k", BOT_TOKEN: "1:x", TELEGRAM_API_ROOT: s.origin, DATA_ORIGIN: s.origin, WORKER_URL: "https://app.example" };
  await requestNotes(env, A, await tg(env, 1, "David"), "X", new Date(), undefined, true);
  await requestNotes(env, B, await tg(env, 1, "David"), "Y", new Date(), undefined, true);
  assert.equal((await deliverReadyNotes(env, sender)).ready, 0);
  assert.ok(await getRequest(env, A)); assert.ok(await getRequest(env, B));
  assert.equal(s.sent.length, 0, "nobody is told");
});

test("the admins get one summary per run, however many requests close", async (t) => {
  const s = await stand([{ kind: "class", title: "First", videoId: A, url: "/classes/a" }, { kind: "captains", title: "Second", videoId: B, url: "/captains/b" }]);
  t.after(s.close);
  const env = { SUBS: kv(), PRIVACY_KEY: "k", BOT_TOKEN: "1:x", TELEGRAM_API_ROOT: s.origin, DATA_ORIGIN: s.origin, WORKER_URL: "https://app.example", ADMIN_IDS: "900" };
  await requestNotes(env, A, await tg(env, 1, "David"), "First", new Date(), undefined, true);
  await requestNotes(env, B, 4, "Second");
  assert.equal((await deliverReadyNotes(env, sender)).ready, 2);
  const toAdmin = s.sent.filter((m) => m.chat_id === 900);
  assert.equal(toAdmin.length, 1, "one message for the run");
  assert.match(toAdmin[0].text, /\(2\)/); assert.match(toAdmin[0].text, /First/); assert.match(toAdmin[0].text, /Second/);
  // A run that closes nothing sends the admins nothing.
  await deliverReadyNotes(env, sender);
  assert.equal(s.sent.filter((m) => m.chat_id === 900).length, 1);
});

test("nothing is closed when the notes index cannot be read", async (t) => {
  const env = { SUBS: kv(), PRIVACY_KEY: "k", BOT_TOKEN: "1:x", DATA_ORIGIN: "http://127.0.0.1:9" };
  await requestNotes(env, A, await tg(env, 1, "David"), "X", new Date(), undefined, true);
  assert.equal((await deliverReadyNotes(env, sender)).skipped, "index_down");
  assert.ok(await getRequest(env, A));
});

test("the message escapes what the notes index says", () => {
  assert.equal(readyMessage({ video: A, title: "Kings & <Queens>" }), "<b>Your notes are ready</b>\nKings &amp; &lt;Queens&gt;");
});
