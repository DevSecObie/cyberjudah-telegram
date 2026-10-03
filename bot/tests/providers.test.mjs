import { test } from "node:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import { claude, claudeUnavailable, hasClaude, unifiedBilling, viaGateway } from "../src/providers.ts";

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
  assert.deepEqual(viaGateway({ AI_GATEWAY: "default" }), { gateway: { id: "default" } });
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
  assert.equal(sent.headers.get("x-api-key"), null, "a provider key on the request would bypass Unified Billing");
  assert.equal(sent.headers.get("authorization"), null);
  // Even when an Anthropic key is still on the Worker, it is not sent.
  const withKey = await sentHeaders({ ...env, ANTHROPIC_API_KEY: "k" });
  assert.equal(withKey.headers.get("x-api-key"), null);
  // Without the token (or the gateway) it cannot be paid through Cloudflare: the key is used if there is one.
  assert.equal(unifiedBilling({ ...env, CF_AIG_TOKEN: undefined }), false);
  assert.equal(hasClaude({ ...env, CF_AIG_TOKEN: undefined }), false);
  assert.equal(hasClaude({ ...env, CF_AIG_TOKEN: undefined, ANTHROPIC_API_KEY: "k" }), true);
  const keyed = await sentHeaders({ ...env, CF_AIG_TOKEN: undefined, ANTHROPIC_API_KEY: "k" });
  assert.equal(keyed.headers.get("x-api-key"), "k");
  assert.equal(unifiedBilling({ ...env, AI_GATEWAY: undefined }), false);
  // Billed by Anthropic unless Cloudflare is chosen.
  assert.equal(unifiedBilling({ ...env, CLAUDE_BILLING: undefined }), false);
  const anthropic = await sentHeaders({ ...env, CLAUDE_BILLING: "anthropic", ANTHROPIC_API_KEY: "k" });
  assert.equal(anthropic.headers.get("x-api-key"), "k");
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
