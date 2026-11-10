import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { DatabaseSync } from "node:sqlite";
import { modelOf } from "../../shared/ask-models.mjs";

// An answer that used a signed-in reader's own data (saved chats, reminder) is that reader's alone:
// (boundedAnswer, the cache's other writer at ai.ts:462, runs no tools at all.)
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
await build({ stdin: { contents: 'export { answerAppAgent, ask, askStream } from "./src/ai.ts"; export { askJson } from "./src/ask-json.ts";', resolveDir: root, loader: "ts" }, bundle: true, format: "esm", platform: "node", packages: "external", outfile: aiOut, logLevel: "error", plugins: [{ name: "agent", setup(b) {
  b.onResolve({ filter: /^\.\/agent$/ }, (args) => args.importer.endsWith("ai.ts") ? { path: "agent", namespace: "fixture" } : undefined);
  b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ loader: "js", contents:
    `export async function runAgent(env, ...args) { env.agentArgs = args; return { text: "Keep it for ever [1].", units: 0, calls: 1, cut: false, refused: false, grounded: true, actions: [], plan: null, tracked: false, readerData: env.readerData,
       passages: [{ n: 1, kind: "note", title: "A class", url: "/classes/a", text: "Recorded class words." }], ...env.agentResult }; }
     export const claudeUnavailable = () => false; export const alertClaudeFunds = async () => {};` }));
} }] });
const ai = await import(aiOut);

const plan = [{ id: 'p1', ask: 'Keep it for ever', refs: [] }, { id: 'p2', ask: 'The unfinished practice', refs: [] }];
const partial = { tracked: true, plan, coverage: { complete: false, stopped: 'budget', parts: [{ id: 'p1', status: 'covered', sources: [1] }, { id: 'p2', status: 'missing', sources: [] }] } };
const setup = (agentResult) => ({ DB: d1(), SUBS: kv(), PRIVACY_KEY: 'test-key', AI_GATEWAY: 'fixture', agentResult,
  CLAUDE_MODEL: '@cf/google/gemma-4-26b-a4b-it', ASK_FREE_MODEL: '@cf/google/gemma-4-26b-a4b-it', ASK_FREE_MODELS: '@cf/google/gemma-4-26b-a4b-it',
  AI: { run: async () => ({ data: [[0.1, 0.2]] }) }, VEC: { query: async () => ({ matches: [] }) } });

for (const route of ['app', 'legacy', 'stream', 'json']) {
  test(`${route}: unfinished research retains plan, coverage, unfinished parts and stop reason`, async () => {
    const env = setup(partial), q = 'Why do we keep the Passover?', consent = ['Cloudflare (Workers AI)'];
    let result;
    if (route === 'app') result = await ai.answerAppAgent(env, q, 'acct-study', [], consent);
    else if (route === 'legacy') result = await ai.ask(env, q, 7, undefined, [], consent);
    else {
      const response = await ai.askStream(env, q, 7, undefined, [], undefined, false, env.CLAUDE_MODEL, consent);
      result = route === 'json' ? await (await ai.askJson(response, q, Date.now())).json() : (await response.text()).trim().split('\n').map(JSON.parse).find(event => event.done);
    }
    assert.ok(result.answer, JSON.stringify(result));
    assert.equal(result.partial, true);
    assert.equal(result.coverage.complete, false);
    assert.equal(result.coverage.stopped, 'budget');
    assert.deepEqual(result.plan.parts, plan.map(({ id, ask }) => ({ id, ask })));
    assert.deepEqual(result.unfinished, [{ id: 'p2', ask: plan[1].ask }]);
    assert.equal([...env.SUBS.m.keys()].filter(key => key.startsWith('ask_cache:')).length, 0);
  });
}

test('a complete cached study replays its complete coverage without another agent run', async () => {
  const complete = { tracked: true, plan: plan.slice(0, 1), coverage: { complete: true, stopped: 'covered', parts: partial.coverage.parts.slice(0, 1) } };
  const env = setup(complete), args = [env, 'Why do we keep the Passover?', 'acct-complete', [], ['Cloudflare (Workers AI)']];
  const first = await ai.answerAppAgent(...args);
  assert.equal(first.coverage.complete, true);
  assert.equal(first.partial, undefined);
  assert.equal([...env.SUBS.m.keys()].filter(key => key.startsWith('ask_cache:')).length, 1);
  env.agentResult = partial;
  const replay = await ai.answerAppAgent(...args);
  assert.deepEqual(replay.coverage, first.coverage);
  assert.deepEqual(replay.plan, first.plan);
});

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

test("the cached path never gives the agent a reader, so no reader tool can read anyone's data there", async () => {
  const env = { DB: d1(), SUBS: kv(), PRIVACY_KEY: "test-key", AI_GATEWAY: "fixture", readerData: false,
    ASK_FREE_MODEL: "@cf/google/gemma-4-26b-a4b-it", ASK_FREE_MODELS: "@cf/google/gemma-4-26b-a4b-it",
    AI: { run: async () => ({ data: [[0.1, 0.2]] }) }, VEC: { query: async () => ({ matches: [] }) } };
  assert.equal((await ai.answerAppAgent(env, "Why do we keep the Passover?", "acct-g7b", [], ["Cloudflare (Workers AI)"], { adminId: 42 })).ok, true);
  // runAgent(env, question, history, first, retrieve, emit, ctx, userId, ...): ctx and userId stay empty.
  assert.equal(env.agentArgs[5], undefined, "no execution context");
  assert.equal(env.agentArgs[6], undefined, "no reader id");
});
