#!/usr/bin/env node
/**
 * Drafts class notes from the captions, in the house format of blog/<year>/<date>-<slug>.md,
 * for classes that have a transcript but no write-up, and opens one pull request to the
 * cyberjudah repository with the drafts for review. Nothing goes to the site unreviewed.
 *
 * How a draft is made: the captions are cut into parts of about 4,000 words; the model reads
 * each part and lists what it holds (the Scripture read, with the second it was opened; the
 * points made; announcements). A last pass writes the note from those lists. The verses
 * themselves are quoted from the KJV data, never from the model, so Scripture is exact.
 *
 *   node scripts/draft-note.mjs [--count N] [--video ID ...] [--out DIR] [--no-pr]
 *
 * Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID; and CYBERJUDAH_TOKEN (a fine-grained
 * token with contents and pull-request write on DevSecObie/cyberjudah) to open the PR.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ANSWER_MODEL } from "../src/ai.mjs";

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const COUNT = Number(opt("--count")) || 2;
const VIDEOS = args.flatMap((a, i) => (a === "--video" ? [args[i + 1]] : []));
const OUT = opt("--out") ?? "drafts";
const NO_PR = args.includes("--no-pr");
const REPO = process.env.TRANSCRIPTS_REPO ?? "DevSecObie/cyberjudah", BRANCH = "main";
const DATA_ORIGIN = process.env.DATA_ORIGIN ?? "https://data.cyberjudah.io";
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID, TOKEN = process.env.CLOUDFLARE_API_TOKEN, GH = process.env.CYBERJUDAH_TOKEN ?? process.env.GITHUB_TOKEN;
const PART_WORDS = 4000;

const getJson = async (url, headers = {}, init = {}) => { const r = await fetch(url, { ...init, headers }); if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json(); };
const gh = (path, init = {}) => getJson(`https://api.github.com${path}`, { accept: "application/vnd.github+json", ...(GH ? { authorization: `Bearer ${GH}` } : {}), "content-type": "application/json", ...(init.headers ?? {}) }, init);
const llm = async (messages, max_tokens = 1500) => {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/${ANSWER_MODEL}`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({ messages, max_tokens, temperature: 0.2 }) });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.success) return (body.result?.response ?? "").trim();
    if (attempt >= 3) throw new Error(`Workers AI: ${res.status} ${JSON.stringify(body.errors ?? body).slice(0, 200)}`);
    await new Promise((r) => setTimeout(r, 3000 * attempt));
  }
};
const mmss = (s) => { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`; };
const slugify = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);

// The books, for turning "Matthew 15:24" into a link and its verses into a quotation.
const books = await getJson(`${DATA_ORIGIN}/api/kjv/books.json`);
const ABBR = { gen: "Genesis", ex: "Exodus", exo: "Exodus", lev: "Leviticus", num: "Numbers", deut: "Deuteronomy", josh: "Joshua", judg: "Judges", ps: "Psalms", psa: "Psalms", psalm: "Psalms", prov: "Proverbs", eccl: "Ecclesiastes", isa: "Isaiah", jer: "Jeremiah", lam: "Lamentations", ezek: "Ezekiel", dan: "Daniel", hos: "Hosea", mic: "Micah", hab: "Habakkuk", zeph: "Zephaniah", zech: "Zechariah", mal: "Malachi", matt: "Matthew", mk: "Mark", lk: "Luke", jn: "John", rom: "Romans", gal: "Galatians", eph: "Ephesians", phil: "Philippians", col: "Colossians", heb: "Hebrews", jas: "James", rev: "Revelation", sir: "Sirach", wis: "Wisdom of Solomon", tob: "Tobit", bar: "Baruch" };
const findBook = (name) => { const n = name.toLowerCase().replace(/\./g, "").trim(); const full = ABBR[n] ?? n; return books.find((b) => b.book.toLowerCase() === full) ?? books.find((b) => b.book.toLowerCase().startsWith(full)) ?? null; };
const chapterCache = new Map();
const chapterOf = async (slug, ch) => { const k = `${slug}/${ch}`; if (!chapterCache.has(k)) chapterCache.set(k, getJson(`${DATA_ORIGIN}/api/kjv/${slug}/${ch}.json`).catch(() => null)); return chapterCache.get(k); };
const short = (b) => b.replace("Wisdom of Solomon", "Wis").replace(/^(\w{4})\w*/, (_, a) => a).replace(/^(\d) (\w{3})\w*/, "$1 $2");

/** The classes with captions but no note, newest first, from the repository's trees. */
async function unwritten() {
  const tree = await gh(`/repos/${REPO}/git/trees/${BRANCH}:blog/transcripts`);
  const notes = new Set();
  for (const y of (await gh(`/repos/${REPO}/git/trees/${BRANCH}:blog`)).tree.filter((e) => e.type === "tree" && /^\d{4}$/.test(e.path))) {
    for (const f of (await gh(`/repos/${REPO}/git/trees/${BRANCH}:blog/${y.path}`)).tree) if (f.path.endsWith(".md")) notes.add(`${y.path}/${f.path.replace(/\.md$/, "")}`);
  }
  const out = [];
  for (const e of tree.tree) {
    if (e.type !== "blob" || !e.path.endsWith(".json")) continue;
    const t = await getJson(`https://raw.githubusercontent.com/${REPO}/${BRANCH}/blog/transcripts/${e.path}`);
    if (!t.date || !t.segments?.length || t.words < 2000) continue;
    if (notes.has(t.slug) || [...notes].some((n) => n.endsWith(`-${slugify(t.cleanTitle ?? t.title)}`))) continue;
    out.push(t);
    if (out.length >= 400) break;
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

function parts(segments) {
  const out = []; let cur = [], words = 0;
  for (const [t, text] of segments) { cur.push(`[${mmss(t)}] ${text}`); words += text.split(/\s+/).length; if (words >= PART_WORDS) { out.push(cur.join("\n")); cur = []; words = 0; } }
  if (cur.length) out.push(cur.join("\n"));
  return out;
}

const EXTRACT = `You read one part of the captions of a Bible class (IUIC in the ClassRoom). Every line starts with its time in the recording. Return JSON only, with this shape:
{"scriptures":[{"ref":"Matthew 15:24","at":"12:45","point":"one sentence: what the teacher drew from it"}],"points":["a point the teacher made, one sentence each, in order"],"announcements":["an announcement or a reference to a book, film or event"],"teacher":"the teacher's name if said, else null"}
Rules: a scripture is one the teacher actually reads or turns to, with the time it is opened; refs as Book chapter:verse or verse-range; keep points to what was taught, in plain words, no praise, no commentary of your own; leave lists empty when there is nothing.`;
const COMPOSE = `You write the notes of a Bible class for CyberJudah's library, from the lists extracted from its captions. Plain, careful English; the teacher's interpretations stay the teacher's ("the teacher says", "the class treats this as"); no praise, no commentary of your own, no headings other than those asked for. Return JSON only:
{"introduction":"two or three short paragraphs: what the class covers and how it moves","closing":"one or two paragraphs: how the class ends","tags":["four to six lower-case topic tags like passover, marriage-family, captivity"],"description":"one line under 120 characters"}`;

async function draft(t) {
  const video = t.videoId, title = (t.cleanTitle ?? t.title).replace(/\s+/g, " ").trim();
  const extracted = [];
  for (const [i, part] of parts(t.segments).entries()) {
    const raw = await llm([{ role: "system", content: EXTRACT }, { role: "user", content: `Part ${i + 1} of the captions of "${title}":\n\n${part}` }], 1200);
    try { extracted.push(JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1))); } catch { extracted.push({ scriptures: [], points: [], announcements: [] }); }
  }
  const scriptures = extracted.flatMap((e) => e.scriptures ?? []);
  const points = extracted.flatMap((e) => e.points ?? []);
  const announcements = extracted.flatMap((e) => e.announcements ?? []);
  const teacher = extracted.map((e) => e.teacher).find((x) => x && /captain|deacon|bishop|elder|officer/i.test(x)) ?? "";
  const compRaw = await llm([{ role: "system", content: COMPOSE }, { role: "user", content: `Title: ${title}\nDate: ${t.date}\n\nScripture opened, in order:\n${scriptures.map((s) => `- ${s.ref} at ${s.at}: ${s.point}`).join("\n")}\n\nPoints made, in order:\n${points.map((p) => `- ${p}`).join("\n")}\n\nAnnouncements:\n${announcements.map((a) => `- ${a}`).join("\n")}` }], 1200);
  let comp = { introduction: "", closing: "", tags: [], description: `IUIC in the ClassRoom · ${t.date}` };
  try { comp = { ...comp, ...JSON.parse(compRaw.slice(compRaw.indexOf("{"), compRaw.lastIndexOf("}") + 1)) }; } catch { /* the lists still make a note */ }

  // The Scripture sections: the reference linked, the verses quoted from the KJV, the point under them.
  const opened = [], sections = [];
  for (const s of scriptures) {
    const m = /^((?:[1-3]\s*)?[A-Za-z][A-Za-z .]*?)\s*(\d{1,3})(?::(\d{1,3})(?:\s*-\s*(\d{1,3}))?)?$/.exec((s.ref ?? "").trim());
    if (!m) continue;
    const book = findBook(m[1]); if (!book) continue;
    const ch = Number(m[2]), v1 = m[3] ? Number(m[3]) : null, v2 = m[4] ? Number(m[4]) : v1;
    const chap = await chapterOf(book.slug, ch); if (!chap) continue;
    const secs = (() => { const p = String(s.at ?? "0:00").split(":").map(Number); return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : (p[0] || 0) * 60 + (p[1] || 0); })();
    const label = `${short(book.book)} ${ch}`;
    if (!opened.some((o) => o.label === label)) opened.push({ label, href: `/bible/${book.slug}/${ch}` });
    const verses = v1 ? chap.verses.filter((x) => x.verse >= v1 && x.verse <= Math.min(v2, v1 + 11)) : chap.verses.slice(0, 3);
    const ref = `${book.book} ${ch}${v1 ? `:${v1}${v2 && v2 !== v1 ? `-${v2}` : ""}` : ""}`;
    const quote = verses.map((x) => `> <sup>[${x.verse}](/bible/${book.slug}/${ch}#v${x.verse})</sup> ${x.text}`).join("\n>\n");
    sections.push(`**[${ref}](/bible/${book.slug}/${ch}${v1 ? `#v${v1}` : ""})**  *[[${mmss(secs)}](https://www.youtube.com/watch?v=${video}&t=${secs}s)]*\n\n${quote}\n\n- ${s.point ?? ""}`);
  }
  const slug = t.slug ?? `${t.date.slice(0, 4)}/${t.date}-${slugify(title)}`;
  const tags = ["IUIC in the ClassRoom", ...(comp.tags ?? []).map((x) => slugify(String(x)))].filter(Boolean);
  const md = `---
title: "${title.replace(/"/g, "'")}"
slug: "${slug}"
date: "${t.date}"
description: "${String(comp.description).replace(/"/g, "'")}"
tags: [${tags.map((x) => `"${x}"`).join(", ")}]
teacher: "${teacher}"
draft: true
---

<p class="taught">IUIC in the ClassRoom · ${t.date}</p>

<span class="opens"><b>Opens</b> ${opened.map((o) => `[${o.label}](${o.href})`).join(" · ")}</span>

<!-- truncate -->

<div class="class-video-mount" data-video-id="${video}"></div>

> **Draft from the captions.** Written by a model from the recording's captions and the KJV text; the Scripture is quoted from the text, the rest needs a reader's review before it is published.

## Introduction

${comp.introduction}

## Scriptures Opened

${sections.join("\n\n")}

## In Closing

${comp.closing}

## Announcements & References

${announcements.map((a) => `- ${a}`).join("\n") || "- None recorded."}

[Class Notes Index](/classes) · [Watch the full session on YouTube](https://www.youtube.com/watch?v=${video})
`;
  return { path: `blog/${slug}.md`, md, title };
}

const list = VIDEOS.length ? await Promise.all(VIDEOS.map((v) => getJson(`https://raw.githubusercontent.com/${REPO}/${BRANCH}/blog/transcripts/${v}.json`))) : (await unwritten()).slice(0, COUNT);
console.error(`${list.length} classes to draft`);
mkdirSync(OUT, { recursive: true });
const drafts = [];
for (const t of list) {
  try { const d = await draft(t); writeFileSync(join(OUT, `${t.videoId}.md`), d.md); drafts.push(d); console.error(`drafted ${d.title}`); }
  catch (e) { console.error(`::warning::${t.videoId}: ${e.message}`); }
}
if (NO_PR || !drafts.length || !GH) { console.error(`${drafts.length} drafts in ${OUT}${NO_PR || !GH ? " (no pull request)" : ""}`); process.exit(0); }

// One branch, one commit per draft, one pull request.
const base = await gh(`/repos/${REPO}/git/ref/heads/${BRANCH}`);
const branch = `drafts/${new Date().toISOString().slice(0, 10)}-${Math.random().toString(36).slice(2, 6)}`;
await gh(`/repos/${REPO}/git/refs`, { method: "POST", body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: base.object.sha }) });
for (const d of drafts) await gh(`/repos/${REPO}/contents/${d.path}`, { method: "PUT", body: JSON.stringify({ message: `classes: draft ${d.title} from the captions (for review)`, content: Buffer.from(d.md).toString("base64"), branch }) });
const pr = await gh(`/repos/${REPO}/pulls`, { method: "POST", body: JSON.stringify({ title: `Class notes drafted from the captions: ${drafts.length} for review`, head: branch, base: BRANCH, body: `Drafts written by a model from the recordings' captions, the Scripture quoted from the KJV text. Each is marked \`draft: true\` and carries a review note at the top; remove both when it reads right.\n\n${drafts.map((d) => `- ${d.title} (\`${d.path}\`)`).join("\n")}\n\n---\n_Generated by [Claude Code](https://claude.ai/code)_` }) });
console.error(`pull request: ${pr.html_url}`);
