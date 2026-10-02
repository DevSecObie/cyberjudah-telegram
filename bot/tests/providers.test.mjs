import { test } from "node:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import { claude, claudeUnavailable, viaGateway } from "../src/providers.ts";

const apiError = (status) => Anthropic.APIError.generate(status, { error: { type: "x", message: "m" } }, "m", new Headers());

test("Claude being unavailable (overloaded, rate limited, down, key refused, connection lost) sends Ask to the backup", () => {
  for (const s of [401, 403, 408, 409, 429, 500, 502, 503, 529]) assert.equal(claudeUnavailable(apiError(s)), true, String(s));
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
