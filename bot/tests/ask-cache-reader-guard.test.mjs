import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { DatabaseSync } from "node:sqlite";
import { modelOf } from "../../shared/ask-models.mjs";

// An answer that used a signed-in reader's own data (saved chats, reminder) is that reader's alone:
// it must never be kept in the shared answer cache, where another reader asking the same words with
// the same model would be given it (OWASP LLM02, threat model G7).

const root = new URL("..", import.meta.url).pathname;
const agentOut = new URL("./.build/ask-cache-reader-guard-agent.mjs", import.meta.url).pathname;
await build({ stdin: { contents: 'export { runAgent } from "./src/agent.ts";', resolveDir: root, loader: "ts" }, bundle: true, format: "esm", platform: "node", packages: "external", outfile: agentOut, logLevel: "error", plugins: [{ name: "fixtures", setup(b) {
  b.onResolve({ filter: /^\.\/(providers|resource-tools|ask-tools|data)$/ }, (args) => args.importer.endsWith("agent.ts") ? { path: args.path.slice(2), namespace: "fixture" } : undefined);
  b.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({ loader: "js", contents: {
    providers: "export async function claude(env) { return env.client ?? {}; }",
    "resource-tools": "export async function resolveResourcePins() { return {}; }",
    "ask-tools": "export const MORE_TOOLS=[]; export const MORE_RUN={};",
    data: "export async function dataJson() { return null; } export async function books() { return []; } export async function chapter() { return null; }",
  }[args.path] }));
} }] });
const { runAgent } = await import(agentOut);

const kv = () => { const m = new Map(); return { m, get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); }, list: async () => ({ keys: [], list_complete: true }) }; };
const d1 = () => { const db = new DatabaseSync(":memory:"); const bound = (q, a) => ({ first: async () => db.prepare(q).get(...a) ?? null, all: async () => ({ results: db.prepare(q).all(...a) }), run: async () => { if (/RETURNING/i.test(q)) { const results = db.prepare(q).all(...a); return { results, meta: { changes: results.length } }; } const r = db.prepare(q).run(...a); return { results: [], meta: { changes: Number(r.changes ?? 0) } }; } }); return { prepare: (q) => ({ bind: (...a) => bound(q, a), ...bound(q, []) }), batch: async (s) => Promise.all(s.map((x) => x.run())) }; };
const toolCall = { my_saved_chats: { query: "passover" }, my_reminder: {}, propose_reminder_change: { on: false } };

for (const [tool, args] of Object.entries(toolCall)) {
  test(`${tool} marks the answer as the reader's own only when a signed-in reader's data was used`, async () => {
    for (const userId of [7, undefined]) {
      let calls = 0;
      const env = { SUBS: kv(), DB: d1(), PRIVACY_KEY: "test-key", AI_GATEWAY: "fixture", DATA_ORIGIN: "https://data.test", SITE_URL: "https://site.test",
        AI: { run: async () => (++calls === 1 ? { response: "", tool_calls: [{ name: tool, arguments: args }], usage: { prompt_tokens: 10, completion_tokens: 5 } } : { response: "An answer.", usage: { prompt_tokens: 10, completion_tokens: 5 } }) } };
      const ran = await runAgent(env, "What did I save about the Passover?", [], [], async () => [], () => {}, undefined, userId, modelOf("@cf/google/gemma-4-26b-a4b-it"));
      assert.ok(calls >= 2, "the model was asked again after the tool ran");
      assert.equal(ran.readerData, userId !== undefined, `${tool} with ${userId ? "a signed-in reader" : "no reader"}`);
    }
  });
}

// The cached path (answerAppAgent) with the agent standing in: a run that used the reader's data is not kept.
const aiOut = new URL("./.build/ask-cache-reader-guard-ai.mjs", import.meta.url).pathname;
await build({ stdin: { contents: 'export { answerAppAgent } from "./src/ai.ts";', resolveDir: root, loader: "ts" }, bundle: true, format: "esm", platform: "node", packages: "external", outfile: aiOut, logLevel: "error", plugins: [{ name: "agent", setup(b) {
  b.onResolve({ filter: /^\.\/agent$/ }, (args) => args.importer.endsWith("ai.ts") ? { path: "agent", namespace: "fixture" } : undefined);
  b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ loader: "js", contents:
    `export async function runAgent(env) { return { text: "Keep it for ever [1].", units: 0, calls: 1, cut: false, refused: false, grounded: true, actions: [], plan: null, tracked: false, readerData: env.readerData,
       passages: [{ n: 1, kind: "note", title: "A class", url: "/classes/a", text: "Recorded class words." }] }; }
     export const claudeUnavailable = () => false; export const alertClaudeFunds = async () => {};` }));
} }] });
const ai = await import(aiOut);

for (const readerData of [false, true]) {
  test(`the app's agent answer is ${readerData ? "never" : "still"} kept in the shared cache when the reader's own data was ${readerData ? "" : "not "}used`, async (t) => {
    const env = { DB: d1(), SUBS: kv(), PRIVACY_KEY: "test-key", AI_GATEWAY: "fixture", readerData,
      ASK_FREE_MODEL: "@cf/google/gemma-4-26b-a4b-it", ASK_FREE_MODELS: "@cf/google/gemma-4-26b-a4b-it",
      AI: { run: async () => ({ data: [[0.1, 0.2]] }) }, VEC: { query: async () => ({ matches: [] }) } };
    const r = await ai.answerAppAgent(env, "Why do we keep the Passover?", "acct-g7", [], ["Cloudflare (Workers AI)"]);
    if (!r.ok) { t.diagnostic(JSON.stringify(r)); }
    assert.equal(r.ok, true);
    const kept = [...env.SUBS.m.keys()].filter((k) => k.startsWith("ask_cache:"));
    assert.equal(kept.length, readerData ? 0 : 1);
  });
}
