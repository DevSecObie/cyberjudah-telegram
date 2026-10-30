#!/usr/bin/env node
/**
 * Ask CyberJudah's test set (evals/ask-questions.json), run against a deployed Ask, usually staging,
 * before a change ships. It asks each question as the app does and checks each answer mechanically:
 * that it answered, that every [n] it cites is a source it was given, that every verse it quotes is
 * the King James text word for word (src/verse-guard.mjs), that it names what it was asked about,
 * that it says plainly when the library has nothing, that greetings are short, and that no model or
 * company name or softening disclaimer appears. It writes a Markdown report; nothing is stored.
 *
 *   ASK_URL=https://cyberjudah-telegram-staging.<subdomain>.workers.dev \
 *   ASK_TOKEN=<a Firebase ID token of a test account> node scripts/eval-ask.mjs [--study] [--model id] > report.md
 *
 * The token is read from the environment only and never printed.
 */
import { readFileSync } from "node:fs";
import { guardVerses } from "../src/verse-guard.mjs";

const base = process.env.ASK_URL?.replace(/\/$/, "");
const token = process.env.ASK_TOKEN;
const data = process.env.DATA_ORIGIN || "https://data.cyberjudah.io";
if (!base || !token) { console.error("Set ASK_URL and ASK_TOKEN."); process.exit(2); }
const args = process.argv.slice(2);
const study = args.includes("--study");
const model = args.includes("--model") ? args[args.indexOf("--model") + 1] : undefined;
const { questions } = JSON.parse(readFileSync(new URL("../evals/ask-questions.json", import.meta.url), "utf8"));

const get = async (path) => { const r = await fetch(`${data}${path}`); return r.ok ? r.json() : null; };
const books = await get("/api/kjv/books.json");
const chapters = new Map();
const chapter = async (slug, ch) => { const k = `${slug}/${ch}`; if (!chapters.has(k)) chapters.set(k, await get(`/api/kjv/${k}.json`)); return chapters.get(k); };

// Names that must never appear in an answer (the product carries no AI model or company names), and
// disclaimers that soften or hedge instead of teaching.
const BANNED = [/\b(claude|chatgpt|gpt-?\d|openai|anthropic|llama|gemma|deepseek|gemini|qwen)\b/i, /\bas an ai\b/i, /\blanguage model\b/i, /\bsome (people|scholars|christians) believe\b/i, /\bchristian pastor\b/i, /\bBishop Nathanael\b/];
const GAP = /(not (find|found|covered|in the library)|does not (cover|say|have)|doesn['’]t (cover|have|say)|nothing (on|about) (that|this)|isn['’]t (covered|in)|no (material|passages|teaching) (on|about)|what i('m| am) for|only answer)/i;

const rows = [];
for (const item of questions) {
  const t0 = Date.now();
  let res, body;
  try {
    res = await fetch(`${base}/api/app/ask`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ q: item.q, history: item.history ?? [], consent: ["Cloudflare (Workers AI)"], ...(study ? { ui: "study-v1" } : {}), ...(model ? { model } : {}) }) });
    body = await res.json().catch(() => null);
  } catch (e) { body = { error: String(e.message ?? e).slice(0, 80) }; }
  const ms = Date.now() - t0;
  const answer = String(body?.answer ?? "");
  const sources = Array.isArray(body?.sources) ? body.sources : [];
  const fails = [];
  if (!res?.ok || !answer) fails.push(`no answer (${res?.status ?? "network"} ${body?.error ?? ""})`);
  const cited = [...answer.matchAll(/\[(\d{1,2})\]/g)].map((m) => Number(m[1]));
  const numbers = new Set(sources.map((s) => s.n));
  const stray = cited.filter((n) => !numbers.has(n));
  if (stray.length) fails.push(`cites sources it was not given: ${[...new Set(stray)].join(", ")}`);
  const guard = answer ? await guardVerses(answer, books, chapter) : { checked: 0, fixed: 0, removed: 0 };
  if (guard.fixed || guard.removed) fails.push(`${guard.fixed + guard.removed} verse(s) not quoted word for word`);
  for (const word of item.mention ?? []) if (!answer.toLowerCase().includes(word.toLowerCase())) fails.push(`does not mention “${word}”`);
  for (const kind of item.cites ?? []) if (!sources.some((s) => s.kind === kind)) fails.push(`no ${kind} source`);
  if (item.gap && !GAP.test(answer)) fails.push("does not say plainly that the library does not cover it");
  if (item.short && answer.split(/\s+/).length > 80) fails.push(`too long for a greeting (${answer.split(/\s+/).length} words)`);
  if (item.parts && (answer.match(/^#{2,3} /gm)?.length ?? 0) < item.parts && answer.split(/\n\n/).length < item.parts + 1) fails.push(`may not answer all ${item.parts} parts`);
  for (const re of BANNED) if (re.test(answer)) fails.push(`contains a banned phrase (${re.source})`);
  rows.push({ id: item.id, ms, words: answer.split(/\s+/).filter(Boolean).length, sources: sources.length, verses: guard.checked, fails });
}

const passed = rows.filter((r) => !r.fails.length).length;
const median = [...rows.map((r) => r.ms)].sort((a, b) => a - b)[Math.floor(rows.length / 2)];
console.log(`# Ask test set: ${passed}/${rows.length} passed${study ? " (study mode)" : ""}${model ? ` on ${model}` : ""}\n`);
console.log(`Median time ${(median / 1000).toFixed(1)} s.\n`);
console.log("| Question | Result | Time | Words | Sources | Verses checked |\n|---|---|---|---|---|---|");
for (const r of rows) console.log(`| ${r.id} | ${r.fails.length ? `✗ ${r.fails.join("; ")}` : "✓"} | ${(r.ms / 1000).toFixed(1)} s | ${r.words} | ${r.sources} | ${r.verses} |`);
process.exit(passed === rows.length ? 0 : 1);
