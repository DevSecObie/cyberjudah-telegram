#!/usr/bin/env node
/**
 * Ask's lab: the same questions through two versions of Ask's code (a pull request's base and its
 * head), side by side, without deploying either. Each version is bundled from its own source and
 * run here against the real library: Workers AI, the Vectorize index and the D1 databases are
 * reached read-only through Cloudflare's REST API, and nothing is written anywhere.
 *
 *   node scripts/ask-lab.mjs build <src/ai.ts dir> <out.mjs>          bundle one version
 *   node scripts/ask-lab.mjs run --base base.mjs --head head.mjs [--answers] [--only a,b] [--out lab.json]
 *
 * For every question it measures:
 *   - retrieval: of the first eight passages, how many a judge model finds actually help answer the
 *     question (precision@8), whether a recorded class moment is among them, and whether a Bishop's
 *     or Deacon's class is;
 *   - with --answers, the whole answer from the free model: how many of its claims the sources
 *     support (faithfulness, judged), its citations, its length, and whether it reads as talk or as
 *     a form (headings, lists, set openings).
 * The judge is a larger Workers AI model; it only reads, and its verdicts are kept in the output so
 * every number can be checked by hand.
 *
 * Needs CLOUDFLARE_API_TOKEN (Workers AI, Vectorize and D1 read) and CLOUDFLARE_ACCOUNT_ID.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const [, , command, ...rest] = process.argv;
const arg = (name, fallback) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : fallback; };
const flag = (name) => rest.includes(`--${name}`);

if (command === "build") {
  const [srcRoot, out] = rest;
  const { build } = await import("esbuild");
  const root = resolve(srcRoot);
  const entry = `export { retrieve } from ${JSON.stringify(`${root}/bot/src/ai`)};
export { runAgent } from ${JSON.stringify(`${root}/bot/src/agent`)};
export { answerCandidates, retrievalText, splitFollowups } from ${JSON.stringify(`${root}/bot/src/ai.mjs`)};
export { makeSpend } from ${JSON.stringify(`${root}/bot/src/spend`)};
export { modelOf } from ${JSON.stringify(`${root}/shared/ask-models.mjs`)};`;
  await build({ stdin: { contents: entry, resolveDir: root, loader: "ts" }, bundle: true, platform: "node", format: "esm", outfile: out, external: ["cloudflare:*"], logLevel: "warning",
    // Some packages (grammy) still require Node built-ins.
    banner: { js: "import { createRequire as __labRequire } from \"node:module\"; const require = __labRequire(import.meta.url);" } });
  console.log(`built ${out}`);
  process.exit(0);
}
if (command !== "run") { console.error("usage: ask-lab.mjs build <repo> <out.mjs> | run --base a.mjs --head b.mjs"); process.exit(2); }

const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID, TOKEN = process.env.CLOUDFLARE_API_TOKEN;
if (!ACCOUNT || !TOKEN) { console.error("CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required"); process.exit(2); }
const API = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}`;
const DB_ID = process.env.LAB_DB_ID ?? "516961da-b1d5-47c4-a3e4-47273e180c41";     // staging's library search
const TEACH_ID = process.env.LAB_TEACH_ID ?? "4cad355d-256e-4d2c-805c-2b9ecb1aaccd"; // the site's captions
const INDEX = "cyberjudah-teachings";
const FREE_MODEL = process.env.LAB_MODEL ?? "@cf/google/gemma-4-26b-a4b-it";
const JUDGE = process.env.LAB_JUDGE ?? "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

async function cf(path, body, tries = 3) {
  for (let i = 1; ; i++) {
    const res = await fetch(`${API}${path}`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (res.ok && json.success !== false) return json.result;
    if (i >= tries || (res.status < 500 && res.status !== 429)) throw new Error(`${path.split("/").slice(0, 4).join("/")} ${res.status}: ${JSON.stringify(json.errors ?? json).slice(0, 300)}`);
    await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
  }
}

/** Read-only stand-ins for the Worker's bindings. */
const ai = { run: (model, input) => { const { stream: _s, ...body } = input ?? {}; return cf(`/ai/run/${model}`, body); } };
const vec = { query: (vector, opts) => cf(`/vectorize/v2/indexes/${INDEX}/query`, { vector: Array.from(vector), topK: opts?.topK ?? 10, returnMetadata: opts?.returnMetadata ?? "all" }) };
const READ = /^\s*(WITH|SELECT|PRAGMA)\b/i;
function d1(id) {
  const exec = async (sql, params) => {
    if (!READ.test(sql)) return { results: [], meta: { changes: 0 }, success: true }; // the lab never writes
    const [r] = await cf(`/d1/database/${id}/query`, { sql, params });
    return r;
  };
  const statement = (sql, params = []) => ({
    bind: (...p) => statement(sql, p),
    all: async () => ({ results: (await exec(sql, params)).results ?? [], success: true }),
    first: async (col) => { const row = (await exec(sql, params)).results?.[0] ?? null; return col ? row?.[col] ?? null : row; },
    run: async () => exec(sql, params),
    raw: async () => ((await exec(sql, params)).results ?? []).map((r) => Object.values(r)),
    sql, params,
  });
  return { prepare: (sql) => statement(sql), batch: async (list) => { const out = []; for (const s of list) out.push(await s.run()); return out; } };
}
const kv = (() => { const m = new Map(); return { get: async (k, t) => { const v = m.get(k); return v == null ? null : t === "json" ? JSON.parse(v) : v; }, put: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); }, list: async () => ({ keys: [], list_complete: true }) }; })();
globalThis.caches ??= { default: { match: async () => undefined, put: async () => undefined, delete: async () => false } };

const missing = new Set();
const env = new Proxy({
  AI: ai, VEC: vec, DB: d1(DB_ID), TEACH: d1(TEACH_ID), SUBS: kv,
  AI_GATEWAY: "lab", DATA_ORIGIN: "https://data.cyberjudah.io", TRANSCRIPTS_REPO: "DevSecObie/cyberjudah",
  ASK_FREE_MODEL: FREE_MODEL, ASK_FREE_MAX_ROUNDS: "3",
}, { get: (t, k) => { if (!(k in t) && typeof k === "string") missing.add(k); return t[k]; } });

/** One judge call that must come back as JSON. */
async function judge(system, user) {
  const res = await cf(`/ai/run/${JUDGE}`, { messages: [{ role: "system", content: system }, { role: "user", content: user }], max_tokens: 1200, temperature: 0 });
  const text = typeof res?.response === "string" ? res.response : res?.choices?.[0]?.message?.content ?? JSON.stringify(res?.response ?? "");
  const m = /\{[\s\S]*\}/.exec(text);
  try { return m ? JSON.parse(m[0]) : null; } catch { return null; }
}

const passageLine = (p, i) => `[${i + 1}] ${p.title}${p.sub ? ` · ${p.sub}` : ""}${p.teacher ? ` (taught by ${p.teacher})` : ""}\n${String(p.text).slice(0, 900)}`;

async function judgeRetrieval(q, passages) {
  if (!passages.length) return { helpful: [] };
  const verdict = await judge(
    "You grade a search engine for a Bible study library. For each numbered passage decide whether it actually helps answer the question: it explains, teaches or gives the facts the question asks for. A passage that only repeats a word of the question, or is about something else, does not help. Reply with JSON only: {\"helpful\": [numbers]}.",
    `Question: ${q}\n\nPassages:\n${passages.map(passageLine).join("\n\n")}`,
  );
  return { helpful: Array.isArray(verdict?.helpful) ? verdict.helpful.filter((n) => Number.isInteger(n) && n >= 1 && n <= passages.length) : null };
}

async function judgeAnswer(q, answer, sources) {
  if (!answer.trim()) return { claims: 0, unsupported: [], natural: null };
  const verdict = await judge(
    "You check an answer from a Bible study assistant against the sources it was given. List the answer's factual claims (what Scripture says, what the classes teach, names, dates, quotes). A claim is supported only if the sources state it; Bible verses quoted with their reference count as supported when a source gives that verse. Then rate how natural the answer reads, from 1 (a stiff, templated report) to 5 (a knowledgeable person answering directly and conversationally, shaped to this question). Reply with JSON only: {\"claims\": number, \"unsupported\": [\"short claim\", ...], \"natural\": 1-5}.",
    `Question: ${q}\n\nSources:\n${sources.map((p) => passageLine(p, p.n - 1)).join("\n\n").slice(0, 24000)}\n\nAnswer:\n${answer}`,
  );
  return { claims: Number(verdict?.claims) || 0, unsupported: Array.isArray(verdict?.unsupported) ? verdict.unsupported.map(String) : [], natural: Number(verdict?.natural) || null };
}

const LEADER = /^(teachers|bishop|deacon)\b/i;
function shapeOf(answer) {
  const lines = answer.split("\n");
  return {
    words: answer.split(/\s+/).filter(Boolean).length,
    headings: lines.filter((l) => /^#{1,6}\s/.test(l)).length,
    listItems: lines.filter((l) => /^\s*(?:[-*]|\d+\.)\s/.test(l)).length,
    cited: new Set([...answer.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]))).size,
    setOpening: /^(great question|certainly|in summary|here is|let's|the short answer)/i.test(answer.trim()),
  };
}

async function runVersion(lib, item, withAnswer) {
  const t0 = Date.now();
  const spend = lib.makeSpend({ budgetUsd: 0.05 });
  const found = await lib.retrieve(env, lib.retrievalText(item.q, item.history ?? []), 12, spend);
  const top = found.slice(0, 8);
  const retrieval = await judgeRetrieval(item.q, top);
  const out = {
    ms: Date.now() - t0,
    passages: top.map((p) => ({ title: p.title, kind: p.kind, sub: p.sub, video: p.video, t: p.t, url: p.url, teacher: p.teacher ?? "", text: String(p.text).slice(0, 400) })),
    helpful: retrieval.helpful,
    precision: retrieval.helpful ? retrieval.helpful.length / Math.max(1, top.length) : null,
    classMoment: top.some((p) => p.video),
    leader: top.some((p) => LEADER.test(p.teacher ?? "")),
  };
  if (!withAnswer) return out;
  const first = lib.answerCandidates(item.q, found, 8);
  const a0 = Date.now();
  try {
    const ran = await lib.runAgent(env, item.q, item.history ?? [], first, (t, k) => lib.retrieve(env, t, k, spend), () => undefined, undefined, undefined, lib.modelOf(FREE_MODEL), spend, undefined, 3);
    const { answer, followups } = lib.splitFollowups(String(ran.text).replace(/<think>[\s\S]*?<\/think>\s*/gi, ""));
    const verdict = await judgeAnswer(item.q, answer, ran.passages);
    out.answer = { text: answer, followups, ms: Date.now() - a0, sources: ran.passages.map((p) => ({ n: p.n, title: p.title, kind: p.kind, video: p.video, t: p.t, teacher: p.teacher ?? "" })), ...shapeOf(answer), ...verdict, faithful: verdict.claims ? 1 - verdict.unsupported.length / verdict.claims : null };
  } catch (e) { out.answer = { error: String(e?.message ?? e).slice(0, 300) }; }
  return out;
}

const base = await import(resolve(arg("base")));
const head = await import(resolve(arg("head")));
const set = JSON.parse(readFileSync(resolve(arg("questions", new URL("../evals/ask-questions.json", import.meta.url).pathname)), "utf8"));
const only = arg("only", "").split(",").filter(Boolean);
const items = (set.questions ?? set).filter((q) => !only.length || only.includes(q.id));
const withAnswers = flag("answers");

const results = [];
for (const item of items) {
  const row = { id: item.id, q: item.q };
  for (const [name, lib] of [["base", base], ["head", head]]) {
    try { row[name] = await runVersion(lib, item, withAnswers); }
    catch (e) { row[name] = { error: String(e?.message ?? e).slice(0, 300) }; }
  }
  results.push(row);
  const p = (v) => (v?.precision == null ? " –  " : v.precision.toFixed(2));
  console.log(`${item.id.padEnd(24)} precision@8 ${p(row.base)} → ${p(row.head)}${withAnswers ? `  faithful ${row.base.answer?.faithful?.toFixed?.(2) ?? "–"} → ${row.head.answer?.faithful?.toFixed?.(2) ?? "–"}  natural ${row.base.answer?.natural ?? "–"} → ${row.head.answer?.natural ?? "–"}` : ""}`);
}

const mean = (xs) => { const v = xs.filter((x) => typeof x === "number" && Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const summary = Object.fromEntries(["base", "head"].map((name) => [name, {
  precision: mean(results.map((r) => r[name]?.precision)),
  classMoment: mean(results.map((r) => (r[name]?.classMoment ? 1 : 0))),
  leader: mean(results.map((r) => (r[name]?.leader ? 1 : 0))),
  ms: mean(results.map((r) => r[name]?.ms)),
  ...(withAnswers ? {
    faithful: mean(results.map((r) => r[name]?.answer?.faithful)),
    natural: mean(results.map((r) => r[name]?.answer?.natural)),
    words: mean(results.map((r) => r[name]?.answer?.words)),
    headings: mean(results.map((r) => r[name]?.answer?.headings)),
    errors: results.filter((r) => r[name]?.error || r[name]?.answer?.error).length,
  } : {}),
}]));
console.log(JSON.stringify(summary, null, 2));
if (missing.size) console.log(`bindings the code asked for that the lab does not provide: ${[...missing].join(", ")}`);
writeFileSync(arg("out", "ask-lab.json"), JSON.stringify({ at: new Date().toISOString(), model: FREE_MODEL, judge: JUDGE, summary, results }, null, 1));
