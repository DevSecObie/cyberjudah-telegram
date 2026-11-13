import { test } from "node:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import { build } from "esbuild";

const out = new URL("./.build/providers.mjs", import.meta.url).pathname;
await build({ entryPoints: [new URL("../src/providers.ts", import.meta.url).pathname], bundle: true, format: "esm", platform: "node", outfile: out, logLevel: "error", external: ["@anthropic-ai/sdk", "grammy"] });
const { alertClaudeFunds, claude, claudeOutOfFunds, claudeUnavailable, hasClaude, unifiedBilling, viaGateway } = await import(out);

const apiError = (status) => Anthropic.APIError.generate(status, { error: { type: "x", message: "m" } }, "m", new Headers());

test("Claude being unavailable (overloaded, rate limited, down, key refused, connection lost) sends Ask to the backup", () => {
  for (const s of [401, 402, 403, 408, 409, 429, 500, 502, 503, 529]) assert.equal(claudeUnavailable(apiError(s)), true, String(s));
  assert.equal(claudeUnavailable(new Anthropic.APIConnectionError({ message: "lost" })), true, "connection lost");
  // A request Claude rejected as malformed is a bug to see, not an outage to hide.
  assert.equal(claudeUnavailable(apiError(400)), false);
  assert.equal(claudeUnavailable(apiError(404)), false);
  assert.equal(claudeUnavailable(new Error("our own bug")), false);
});

test("the AI Gateway: Workers AI goes through it when named; Claude only with its token, with the gateway's own URL", async () => {
  assert.deepEqual(viaGateway({ AI_GATEWAY: "default" }), { gateway: { id: "default", collectLog: false } }, "calls with a reader's words are not logged");
  assert.deepEqual(viaGateway({ AI_GATEWAY: "default" }, { log: true }), { gateway: { id: "default" } });
  assert.equal(viaGateway({}), undefined);
  const AI = { gateway: (id) => ({ getUrl: async (p) => `https://gateway.ai.cloudflare.com/v1/acct/${id}/${p}` }) };
  const direct = await claude({ ANTHROPIC_API_KEY: "k", AI_GATEWAY: "default", AI });
  assert.equal(direct.baseURL, "https://api.anthropic.com");
  const gw = await claude({ ANTHROPIC_API_KEY: "k", AI_GATEWAY: "default", CF_AIG_TOKEN: "t", AI });
  assert.equal(gw.baseURL, "https://gateway.ai.cloudflare.com/v1/acct/default/anthropic");
  assert.equal(gw._options.defaultHeaders["cf-aig-authorization"], "Bearer t");
  const stand = await claude({ ANTHROPIC_API_KEY: "k", ANTHROPIC_BASE_URL: "http://127.0.0.1:8791/anthropic", AI_GATEWAY: "default", CF_AIG_TOKEN: "t", AI });
  assert.equal(stand.baseURL, "http://127.0.0.1:8791/anthropic", "the tests' stand-in wins");
});

const AI = { gateway: (id) => ({ getUrl: async (p) => `https://gateway.ai.cloudflare.com/v1/acct/${id}/${p}` }) };
/** The headers a real request from claude(env) carries (fetch is caught before it leaves; the SDK keeps the fetch it was made with). */
async function sentHeaders(env) {
  const real = globalThis.fetch;
  let seen;
  globalThis.fetch = async (url, init) => {
    seen = { url: String(url), headers: new Headers(init.headers) };
    return new Response(JSON.stringify({ id: "m", type: "message", role: "assistant", model: "x", content: [], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }), { headers: { "content-type": "application/json" } });
  };
  try { await (await claude(env)).messages.create({ model: "claude-opus-5", max_tokens: 10, messages: [{ role: "user", content: "hi" }] }); }
  finally { globalThis.fetch = real; }
  return seen;
}

test("Unified Billing: Claude is paid through Cloudflare, with no Anthropic key sent, only when the gateway and its token are there", async () => {
  const env = { CLAUDE_BILLING: "cloudflare", AI_GATEWAY: "default", CF_AIG_TOKEN: "t", AI };
  assert.equal(unifiedBilling(env), true);
  assert.equal(hasClaude(env), true, "no Anthropic key needed");
  const sent = await sentHeaders(env);
  assert.equal(sent.url, "https://gateway.ai.cloudflare.com/v1/acct/default/anthropic/v1/messages");
  assert.equal(sent.headers.get("cf-aig-authorization"), "Bearer t");
  assert.equal(sent.headers.get("cf-aig-collect-log-payload"), "false", "the gateway keeps the cost, not the text");
  assert.equal(sent.headers.get("x-api-key"), null, "a provider key on the request would bypass Unified Billing");
  assert.equal(sent.headers.get("authorization"), null);
  // Even when an Anthropic key is still on the Worker, it is not sent.
  const withKey = await sentHeaders({ ...env, ANTHROPIC_API_KEY: "k" });
  assert.equal(withKey.headers.get("x-api-key"), null);
  assert.equal(withKey.headers.get("authorization"), null);
  // Without the token (or the gateway) it cannot be paid through Cloudflare: the key is used if there is one.
  assert.equal(unifiedBilling({ ...env, CF_AIG_TOKEN: undefined }), false);
  assert.equal(hasClaude({ ...env, CF_AIG_TOKEN: undefined }), false);
  assert.equal(hasClaude({ ...env, CF_AIG_TOKEN: undefined, ANTHROPIC_API_KEY: "k" }), true);
  const keyed = await sentHeaders({ ...env, CF_AIG_TOKEN: undefined, ANTHROPIC_API_KEY: "k" });
  // SDK 1.x sends the API key as a Bearer token.
  assert.equal(keyed.headers.get("authorization"), "Bearer k");
  assert.equal(unifiedBilling({ ...env, AI_GATEWAY: undefined }), false);
  // Billed by Anthropic unless Cloudflare is chosen.
  assert.equal(unifiedBilling({ ...env, CLAUDE_BILLING: undefined }), false);
  const anthropic = await sentHeaders({ ...env, CLAUDE_BILLING: "anthropic", ANTHROPIC_API_KEY: "k" });
  assert.equal(anthropic.headers.get("authorization"), "Bearer k");
  assert.equal(anthropic.headers.get("cf-aig-authorization"), "Bearer t", "still through the gateway, for its logs");
  // The tests' stand-in is never Unified Billing.
  assert.equal(unifiedBilling({ ...env, ANTHROPIC_BASE_URL: "http://127.0.0.1:8791/anthropic" }), false);
});

test("Unified Billing with the gateway unreachable: Claude counts as unavailable, so the backup answers", async () => {
  const broken = { gateway: () => ({ getUrl: async () => { throw new Error("down"); } }) };
  const e = await claude({ CLAUDE_BILLING: "cloudflare", AI_GATEWAY: "default", CF_AIG_TOKEN: "t", AI: broken }).then(() => null, (x) => x);
  assert.ok(e instanceof Anthropic.APIConnectionError);
  assert.equal(claudeUnavailable(e), true);
});

test("own-key billing uses the owner's Anthropic key once it is set, and Unified Billing until then", () => {
  const env = { CLAUDE_BILLING: "anthropic", AI_GATEWAY: "default", CF_AIG_TOKEN: "t" };
  assert.equal(unifiedBilling(env), true, "no key yet: Claude stays paid through Cloudflare");
  assert.equal(unifiedBilling({ ...env, ANTHROPIC_API_KEY: "k" }), false, "with the key, the owner's console pays");
  assert.equal(hasClaude({ ...env, ANTHROPIC_API_KEY: "k" }), true);
});

test("an emptied Anthropic console balance hands the answer to the backup", () => {
  const low = new Anthropic.BadRequestError(400, { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." } }, "Your credit balance is too low to access the Anthropic API.", new Headers());
  assert.equal(claudeUnavailable(low), true);
  assert.equal(claudeUnavailable(new Anthropic.BadRequestError(400, {}, "messages: field required", new Headers())), false);
});

test("when Claude's money runs out the admins are told in Telegram, at most once every six hours", async () => {
  const low = new Anthropic.BadRequestError(400, { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." } }, "Your credit balance is too low to access the Anthropic API.", new Headers());
  assert.equal(claudeOutOfFunds(low), true);
  assert.equal(claudeOutOfFunds(apiError(402)), true);
  assert.equal(claudeOutOfFunds(apiError(429)), false, "busy is not out of money");
  const kv = new Map();
  const SUBS = { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); } };
  const sent = [];
  const { createServer } = await import("node:http");
  const server = createServer((req, res) => { let body = ""; req.on("data", (d) => { body += d; }); req.on("end", () => { sent.push({ url: req.url, body }); res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ ok: true, result: { message_id: 1, date: 0, chat: { id: 42, type: "private" } } })); }); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const env = { SUBS, ADMIN_IDS: "42", BOT_TOKEN: "t", ANTHROPIC_API_KEY: "k", TELEGRAM_API_ROOT: `http://127.0.0.1:${server.address().port}` };
    await alertClaudeFunds(env, apiError(429));
    assert.equal(sent.length, 0);
    await alertClaudeFunds(env, low);
    await alertClaudeFunds(env, low);
    assert.equal(sent.length, 1, "one message, not one per question");
    assert.match(sent[0].body, /Claude console balance has run out/);
    assert.match(sent[0].body, /not charged/);
  } finally { server.close(); }
});

test("a funds alert Telegram did not deliver leaves no marker, so the next out-of-funds error tries again", async () => {
  const low = new Anthropic.BadRequestError(400, { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." } }, "Your credit balance is too low to access the Anthropic API.", new Headers());
  const kv = new Map();
  const ttl = new Map();
  const SUBS = { get: async (k) => kv.get(k) ?? null, put: async (k, v, o) => { kv.set(k, v); ttl.set(k, o?.expirationTtl); }, delete: async (k) => { kv.delete(k); } };
  let down = true, delivered = 0;
  const { createServer } = await import("node:http");
  const server = createServer((req, res) => { req.resume(); req.on("end", () => {
    res.setHeader("content-type", "application/json");
    if (down) { res.statusCode = 500; res.end(JSON.stringify({ ok: false, error_code: 500, description: "down" })); return; }
    delivered++; res.end(JSON.stringify({ ok: true, result: { message_id: 1, date: 0, chat: { id: 42, type: "private" } } }));
  }); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const quiet = console.error; console.error = () => {};
  try {
    const env = { SUBS, ADMIN_IDS: "42", BOT_TOKEN: "t", ANTHROPIC_API_KEY: "k", TELEGRAM_API_ROOT: `http://127.0.0.1:${server.address().port}` };
    const NOW = Date.parse("2026-11-09T12:00:00Z");
    await alertClaudeFunds(env, low, NOW);
    assert.equal(kv.get("alert:claude_funds"), new Date(NOW).toISOString(), "the health screen still learns when the money ran out");
    assert.equal(kv.has("alert:claude_funds:told"), false, "not marked told after a failed send");
    assert.equal(ttl.get("alert:claude_funds:tried"), 600, "the next try is ten minutes away");
    assert.equal(ttl.get("alert:claude_funds"), 6 * 3600);
    down = false;
    await alertClaudeFunds(env, low, NOW + 1000);
    assert.equal(delivered, 0, "not tried again within ten minutes: readers' questions do not each wait on Telegram");
    kv.delete("alert:claude_funds:tried"); // ten minutes later (the marker's time to live)
    await alertClaudeFunds(env, low, NOW + 11 * 60_000);
    assert.equal(delivered, 1, "tried again, and delivered");
    assert.equal(kv.has("alert:claude_funds:told"), true);
    assert.equal(kv.get("alert:claude_funds"), new Date(NOW).toISOString(), "still the time the money first ran out");
    await alertClaudeFunds(env, low, NOW + 12 * 60_000);
    assert.equal(delivered, 1, "told once");
    assert.equal(ttl.get("alert:claude_funds:told"), 6 * 3600);
    kv.delete("alert:claude_funds"); // the six hours since the money ran out have passed; still out
    await alertClaudeFunds(env, low, NOW + 6 * 3600_000 + 1000);
    assert.ok(kv.has("alert:claude_funds"), "the health screen's marker never lapses while errors go on");
    assert.equal(delivered, 1, "and the admins, already told, are not told again");
  } finally { console.error = quiet; server.close(); }
});
