import { test } from "node:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import { costFactor, MODELS, modelOf, unitsFor } from "../../shared/ask-models.mjs";
import { PERSONAL_TOOLS, researchOpen, toolsFor } from "../src/agent-open.ts";
import { claudeUnavailable } from "../src/providers.ts";

test("the model list is Cloudflare's catalog: every model priced, spoken to in a known format, Claude with its own id", () => {
  assert.ok(MODELS.length >= 80, `${MODELS.length} models`);
  for (const m of MODELS) {
    assert.ok(m.input >= 0 && m.output >= 0 && m.cacheRead >= 0, m.id);
    assert.ok(["anthropic", "chat", "responses", "messages", "plain"].includes(m.format), m.id);
    if (m.format === "anthropic") assert.match(m.native, /^claude-[a-z]+-\d+(-\d+)?$/, m.id);
  }
  assert.equal(new Set(MODELS.map((m) => m.id)).size, MODELS.length, "no model twice");
  assert.equal(modelOf("claude-opus-5").id, "anthropic/claude-opus-5", "the setup's Claude id finds its model");
  assert.equal(modelOf("no/such-model").id, "anthropic/claude-opus-5", "an unknown choice falls back to the default");
  for (const none of [undefined, null, ""]) assert.equal(modelOf(none, "claude-opus-5").id, "anthropic/claude-opus-5", `no choice (${none}) is the setup's own model`);
  assert.equal(modelOf(undefined, "claude-sonnet-5").id, "anthropic/claude-sonnet-5");
  const free = modelOf("@cf/zai-org/glm-5.3-flash");
  assert.equal(free.format, "chat", "the free model researches with tools");
});

test("an answer is charged at its own model's price, whatever way the provider reports usage", () => {
  const opus = modelOf("claude-opus-5"), gpt = modelOf("openai/gpt-5.1");
  // Claude: uncached input, cache writes, cache reads and output, at $5 / $6.25 / $0.50 / $25.
  assert.equal(unitsFor({ input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 1000, cache_creation_input_tokens: 400 }, opus), 1000 + 500 + 100 + 500);
  // Chat completions: cached tokens are part of prompt_tokens; GPT-5.1 at $1.25 / $0.125 / $10.
  assert.equal(unitsFor({ prompt_tokens: 1000, completion_tokens: 100, prompt_tokens_details: { cached_tokens: 400 } }, gpt), 360);
  // Responses: the same, under input_tokens_details.
  assert.equal(unitsFor({ input_tokens: 1000, output_tokens: 100, input_tokens_details: { cached_tokens: 400 } }, gpt), 360);
  assert.equal(costFactor(opus), 1);
  assert.ok(costFactor(modelOf("@cf/zai-org/glm-5.3-flash")) < 0.05);
});

const TOOLS = [{ name: "search_library", description: "Search.", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } }];
const SCHEMAS = new Map(TOOLS.map((t) => [t.name, t.input_schema]));
/** A stand-in for Cloudflare's AI binding: answers each request in turn, and keeps what it was sent. */
function binding(replies) {
  const sent = [];
  return { sent, env: { AI_GATEWAY: "default", AI: { run: async (model, input, options) => { sent.push({ model, input: structuredClone(input), options }); const r = replies.shift(); if (r instanceof Error) throw r; return r; } } } };
}
async function research(model, replies) {
  const { env, sent } = binding(replies);
  const ran = [], events = [];
  const r = await researchOpen(env, modelOf(model), "SYSTEM", [{ role: "user", content: "Why keep the Passover?" }], TOOLS, SCHEMAS, async (name, input) => { ran.push([name, input]); return { content: "[1] Exodus 12:14" }; }, (e) => events.push(e), 4);
  return { r, sent, ran, events };
}

test("chat completions: the model searches with the same tool, then answers; the gateway is used and every round is charged", async () => {
  const { r, sent, ran } = await research("openai/gpt-5.1", [
    { choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "search_library", arguments: "{\"query\":\"passover\"}" } }] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 1000, completion_tokens: 20 } },
    { choices: [{ message: { role: "assistant", content: "Keep it for ever [1]." }, finish_reason: "stop" }], usage: { prompt_tokens: 1200, completion_tokens: 30 } },
  ]);
  assert.deepEqual(ran, [["search_library", { query: "passover" }]]);
  assert.equal(r.text, "Keep it for ever [1].");
  assert.equal(r.calls, 2);
  assert.equal(r.units, unitsFor({ prompt_tokens: 1000, completion_tokens: 20 }, modelOf("openai/gpt-5.1")) + unitsFor({ prompt_tokens: 1200, completion_tokens: 30 }, modelOf("openai/gpt-5.1")));
  assert.deepEqual(sent[0].options, { gateway: { id: "default", collectLog: false } }, "the reader's question is not logged");
  assert.equal(sent[0].model, "openai/gpt-5.1");
  assert.equal(sent[0].input.tools[0].function.name, "search_library");
  assert.deepEqual(sent[1].input.messages.at(-1), { role: "tool", tool_call_id: "c1", content: "[1] Exodus 12:14" });
});

test("Workers AI's own reply shape, and a tool input that does not fit the schema is refused without running the tool", async () => {
  const { r, ran, sent } = await research("@cf/zai-org/glm-5.3-flash", [
    { response: null, tool_calls: [{ name: "search_library", arguments: { nope: 1 } }], usage: { prompt_tokens: 100, completion_tokens: 5 } },
    { response: "An answer.", usage: { prompt_tokens: 100, completion_tokens: 5 } },
  ]);
  assert.equal(ran.length, 0);
  assert.match(sent[1].input.messages.at(-1).content, /INVALID_INPUT/);
  assert.equal(sent[0].input.max_tokens, 4096, "Cloudflare-hosted models are told how long they may write");
  assert.equal(r.text, "An answer.");
});

test("the Responses API: function calls are answered with their outputs, in order", async () => {
  const { r, sent, ran } = await research("openai/gpt-5.4-pro", [
    { output: [{ type: "function_call", call_id: "f1", name: "search_library", arguments: "{\"query\":\"feasts\"}" }], usage: { input_tokens: 500, output_tokens: 10, input_tokens_details: { cached_tokens: 0 } }, status: "completed" },
    { output: [{ type: "message", content: [{ type: "output_text", text: "The feasts [1]." }] }], usage: { input_tokens: 600, output_tokens: 10, input_tokens_details: { cached_tokens: 0 } }, status: "completed" },
  ]);
  assert.deepEqual(ran, [["search_library", { query: "feasts" }]]);
  assert.equal(sent[0].input.instructions, "SYSTEM");
  assert.deepEqual(sent[1].input.input.at(-1), { type: "function_call_output", call_id: "f1", output: "[1] Exodus 12:14" });
  assert.equal(r.text, "The feasts [1].");
});

test("the Messages format through Cloudflare (non-Claude models that speak it)", async () => {
  const { r, ran } = await research("thinkingmachines/inkling", [
    { content: [{ type: "tool_use", id: "t1", name: "search_library", input: { query: "sabbath" } }], stop_reason: "tool_use", usage: { input_tokens: 100, output_tokens: 5 } },
    { content: [{ type: "text", text: "Remember the sabbath [1]." }], stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 5 } },
  ]);
  assert.deepEqual(ran, [["search_library", { query: "sabbath" }]]);
  assert.equal(r.text, "Remember the sabbath [1].");
});

test("a model without tools answers from the passages given, in one request", async () => {
  const plain = MODELS.find((m) => m.format === "plain");
  const { r, sent } = await research(plain.id, [{ response: "From the passages [1].", usage: { prompt_tokens: 50, completion_tokens: 5 } }]);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].input.tools, undefined);
  assert.equal(r.text, "From the passages [1].");
});

test("a model that fails or cannot be reached counts as unavailable, so Ask's backup answers", async () => {
  const e = await research("openai/gpt-5.1", [new Error("402 out of credits")]).then(() => null, (x) => x);
  assert.ok(e instanceof Anthropic.APIConnectionError);
  assert.equal(claudeUnavailable(e), true);
  const none = await researchOpen({ AI: {} }, modelOf("openai/gpt-5.1"), "S", [], TOOLS, SCHEMAS, async () => ({ content: "" }), () => {}, 2).then(() => null, (x) => x);
  assert.ok(none instanceof Anthropic.APIConnectionError, "no gateway configured");
});

test("the reader's saved chats and reminder are offered only to Cloudflare-hosted models, never to a third-party provider", async () => {
  const mine = [...TOOLS, ...[...PERSONAL_TOOLS].map((name) => ({ name, description: "Yours.", input_schema: { type: "object", properties: {}, required: [] } }))];
  const names = (model) => toolsFor(modelOf(model), mine).map((t) => t.name);
  for (const hosted of ["@cf/zai-org/glm-5.3-flash", "@cf/deepseek-ai/deepseek-v4-pro-0813"]) assert.deepEqual(names(hosted), ["search_library", "my_saved_chats", "my_reminder"], hosted);
  for (const third of ["openai/gpt-5.1", "claude-opus-5", "deepseek/deepseek-v4-pro", "google/gemini-3.1-pro"]) assert.deepEqual(names(third), ["search_library"], third);

  // Even when given them, a third-party model is not sent them, and a call to one is not run.
  const { env, sent } = binding([
    { choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "my_saved_chats", arguments: "{}" } }] }, finish_reason: "tool_calls" }] },
    { choices: [{ message: { role: "assistant", content: "Done." }, finish_reason: "stop" }] },
  ]);
  const ran = [];
  await researchOpen(env, modelOf("openai/gpt-5.1"), "S", [{ role: "user", content: "My chats?" }], mine, new Map(mine.map((t) => [t.name, t.input_schema])), async (name) => { ran.push(name); return { content: "Your chat titles" }; }, () => {}, 3);
  assert.deepEqual(sent[0].input.tools.map((t) => t.function.name), ["search_library"]);
  assert.deepEqual(ran, []);
  assert.equal(sent[1].input.messages.at(-1).content, "No tool named my_saved_chats.");
});
