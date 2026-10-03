#!/usr/bin/env node
/**
 * Checks The Final Captivity's data (README.md here) before it is built or published.
 *
 *   node app/scripts/final-captivity/check.mjs            the shape, dates, links and rules
 *   CJ_ROOT=../cyberjudah node …/check.mjs                 also against the corpus: every cited
 *                                                          recording exists, its moment is inside
 *                                                          it, every quote is in the recording in the
 *                                                          ten minutes from that moment, every scripture is a real verse
 *
 * Prints each problem and exits 1 if there is any. Drafts are checked for shape only.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => JSON.parse(fs.readFileSync(path.join(HERE, f), "utf8"));

export const GROUPS = [
  "African captivity", "Transatlantic trade", "Slavery", "Resistance", "Abolition",
  "Caribbean and Latin America", "Native dispossession", "Reconstruction and Jim Crow",
  "Civil rights", "Other atrocities", "Achievements", "Identity and erasure", "Forerunners", "Israel United in Christ",
];
export const PEOPLES = ["Black", "Hispanic", "Native"];
const PRECISION = ["day", "month", "year", "circa", "range", "decade"];
const KINDS = ["class", "history", "site", "note"];
/** Book names as the app writes them (AGENTS.md), with the Apocrypha. */
export const BOOKS = ["Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy", "Joshua", "Judges", "Ruth", "1 Samuel", "2 Samuel", "1 Kings", "2 Kings", "1 Chronicles", "2 Chronicles", "Ezra", "Nehemiah", "Esther", "Job", "Psalms", "Proverbs", "Ecclesiastes", "Song of Solomon", "Isaiah", "Jeremiah", "Lamentations", "Ezekiel", "Daniel", "Hosea", "Joel", "Amos", "Obadiah", "Jonah", "Micah", "Nahum", "Habakkuk", "Zephaniah", "Haggai", "Zechariah", "Malachi", "1 Esdras", "2 Esdras", "Tobit", "Judith", "Rest of Esther", "Wisdom of Solomon", "Ecclesiasticus", "Baruch", "Epistle of Jeremiah", "Song of the Three Holy Children", "History of Susanna", "Bel and the Dragon", "Prayer of Manasses", "1 Maccabees", "2 Maccabees", "Matthew", "Mark", "Luke", "John", "Acts", "Romans", "1 Corinthians", "2 Corinthians", "Galatians", "Ephesians", "Philippians", "Colossians", "1 Thessalonians", "2 Thessalonians", "1 Timothy", "2 Timothy", "Titus", "Philemon", "Hebrews", "James", "1 Peter", "2 Peter", "1 John", "2 John", "3 John", "Jude", "Revelation"];
const REF = /^(.+?) (\d+)(?::(\d+)(?:-(\d+))?)?(?:-(\d+):(\d+))?$/;
export const parseRef = (r) => { const m = REF.exec(String(r).trim()); return m && BOOKS.includes(m[1]) ? { book: m[1], chapter: +m[2], from: m[3] ? +m[3] : null, to: m[4] ? +m[4] : m[3] ? +m[3] : null } : null; };
const TS = /^(?:(\d+):)?([0-5]?\d):([0-5]\d)$/;
export const seconds = (ts) => { const m = TS.exec(String(ts)); return m ? (+(m[1] ?? 0)) * 3600 + +m[2] * 60 + +m[3] : null; };
/** Words only, lower case: how a quote is matched against auto-captions. */
export const words = (s) => String(s).toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim().replace(/(\d) (?=\d)/g, "$1");

/** Problems with one event (and the slugs seen so far), as strings. `corpus` is optional. */
export function checkEvent(e, periods, { corpus, draft = false, leaders = null } = {}) {
  const p = [];
  const at = `${e.slug ?? "(no slug)"}`;
  const need = (k) => { if (e[k] == null || e[k] === "" || (Array.isArray(e[k]) && !e[k].length)) p.push(`${at}: missing ${k}`); };
  // A draft needs only what places it; the rest is what it is waiting for.
  (draft ? ["slug", "title", "period"] : ["slug", "title", "start", "end", "date", "period", "group", "summary"]).forEach(need);
  if (e.slug && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(e.slug)) p.push(`${at}: slug must be lower-case words joined by hyphens`);
  const period = periods.find((x) => x.id === e.period);
  if (!period) p.push(`${at}: unknown period ${e.period}`);
  if (draft && e.start == null) return p;
  if (!Number.isInteger(e.start) || !Number.isInteger(e.end) || e.end < e.start) p.push(`${at}: start/end must be whole years, end ≥ start`);
  else if (period && (e.start < period.startYear || e.end > period.endYear)) p.push(`${at}: ${e.start}–${e.end} is outside ${period.title} (${period.startYear}–${period.endYear})`);
  if (e.date && (!e.date.text || !PRECISION.includes(e.date.precision))) p.push(`${at}: date needs text and a precision (${PRECISION.join(", ")})`);
  if (e.group && !GROUPS.includes(e.group)) p.push(`${at}: unknown group "${e.group}"`);
  for (const x of e.peoples ?? []) if (!PEOPLES.includes(x)) p.push(`${at}: unknown people "${x}"`);
  for (const s of e.scriptures ?? []) {
    const r = parseRef(s.ref);
    if (!r) p.push(`${at}: scripture "${s.ref}" is not a reference in the app's book names`);
    else if (corpus?.verse && !corpus.verse(r)) p.push(`${at}: scripture "${s.ref}" is not in the KJV`);
  }
  if (e.leader && leaders && !leaders.some((l) => l.id === e.leader)) p.push(`${at}: leader "${e.leader}" is not in leaders.json`);
  if (e.image) {
    const i = e.image;
    if (!["archival", "generated"].includes(i.kind)) p.push(`${at}: image kind must be archival or generated`);
    if (!i.src || !i.caption) p.push(`${at}: image needs src and caption`);
    if (i.kind === "archival" && (!i.license || !i.sourceUrl || !i.credit)) p.push(`${at}: an archival image needs its credit, licence and source page`);
    if (i.kind === "generated" && !/generated/i.test(i.caption)) p.push(`${at}: a generated image's caption must say it is generated`);
  }
  if (draft) return p;

  if (e.status !== "published") p.push(`${at}: status must be "published" (drafts go in drafts.json)`);
  ["account", "teaching", "sources"].forEach(need);
  for (const t of e.teaching ?? []) {
    const s = t.source ?? {};
    if (!KINDS.includes(s.kind)) p.push(`${at}: teaching source kind must be one of ${KINDS.join(", ")}`);
    if (!s.title || !s.url) p.push(`${at}: teaching source needs a title and a url`);
    if (!t.points?.length && !t.quote) p.push(`${at}: teaching needs points or a quote`);
    if (/\b(the teacher|the speaker|the class teaches|this precept)\b/i.test((t.points ?? []).join(" "))) p.push(`${at}: teaching is said as the class's understanding, not "the teacher says"`);
    if (s.kind === "class" || s.kind === "history") {
      const sec = seconds(s.ts);
      if (sec == null) p.push(`${at}: teaching source needs ts as m:ss or h:mm:ss`);
      if (!/^[\w-]{11}$/.test(s.id ?? "")) p.push(`${at}: teaching source id must be the YouTube video id`);
      else if (sec != null && s.url !== `https://youtu.be/${s.id}?t=${sec}`) p.push(`${at}: url must be https://youtu.be/${s.id}?t=${sec} (the moment)`);
      const rec = corpus?.recording?.(s.id);
      if (corpus?.recording && !rec) p.push(`${at}: recording ${s.id} is not in the corpus`);
      if (rec && sec != null && rec.duration && sec > rec.duration) p.push(`${at}: ${s.ts} is past the end of ${s.id}`);
      if (rec && t.quote && !rec.has(words(t.quote), sec)) p.push(`${at}: quote not found in ${s.id} in the ten minutes from ${s.ts}: "${t.quote.slice(0, 60)}…"`);
    }
  }
  for (const s of e.sources ?? []) {
    if (!s.title || !s.url) p.push(`${at}: each source needs a title and a url`);
    if (s.url && !/^https?:\/\//.test(s.url)) p.push(`${at}: source url must be http(s)`);
  }
  for (const d of e.disagreements ?? []) if (!d.point || !(d.views?.length >= 2)) p.push(`${at}: a disagreement needs its point and at least two views`);
  return p;
}

/** The corpus, when the cyberjudah repository is at hand: recordings and the KJV. */
export function loadCorpus(root) {
  if (!root || !fs.existsSync(root)) return null;
  const cache = new Map();
  const recording = (id) => {
    if (cache.has(id)) return cache.get(id);
    let rec = null;
    for (const d of ["blog/transcripts", "history/transcripts"]) {
      const f = path.join(root, d, `${id}.json`);
      if (!fs.existsSync(f)) continue;
      const t = JSON.parse(fs.readFileSync(f, "utf8"));
      const segs = (t.segments ?? []).filter((s) => Array.isArray(s) && s.length >= 2);
      rec = {
        duration: t.duration,
        has(q, sec) {
          if (!q) return true;
          // From a minute before the moment cited (where that teaching begins) to ten minutes into it.
          const near = segs.filter((s) => s[0] >= (sec ?? 0) - 60 && s[0] <= (sec ?? 0) + 600).map((s) => s[1]).join(" ");
          return words(near).includes(q);
        },
      };
      break;
    }
    cache.set(id, rec);
    return rec;
  };
  const slug = (book) => book.toLowerCase().replace(/ /g, "-");
  const books = new Map();
  const verse = (r) => {
    const f = path.join(root, "data/bible", `${slug(r.book)}.json`);
    if (!books.has(r.book)) books.set(r.book, fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null);
    const b = books.get(r.book);
    if (!b) return true; // a book the corpus names differently: the name was checked already
    const ch = b.chapters?.[String(r.chapter)];
    return !!ch && (r.from == null || (r.from >= 1 && (r.to ?? r.from) <= ch.length && r.from <= (r.to ?? r.from)));
  };
  return { recording, verse };
}

export function checkAll({ corpus } = {}) {
  const { periods } = read("periods.json");
  const events = read("events.json");
  const drafts = read("drafts.json");
  const ledger = read("ledger.json");
  const { leaders } = read("leaders.json");
  const problems = [];
  // Each leader's portrait (owner-supplied photographs, app/public/<photo>-<size>.webp) is there in every size drawn.
  for (const l of leaders) for (const n of [128, 256, 512]) if (!fs.existsSync(path.join(HERE, "../../public", `${l.photo}-${n}.webp`))) problems.push(`leaders.json: ${l.id}: ${l.photo}-${n}.webp is missing`);
  const seen = new Set();
  for (const [list, draft] of [[events, false], [drafts, true]]) {
    for (const e of list) {
      if (seen.has(e.slug)) problems.push(`${e.slug}: slug used twice`);
      seen.add(e.slug);
      problems.push(...checkEvent(e, periods, { corpus, draft, leaders }));
    }
  }
  // Published events in time order within each period (the build places them; this keeps the file readable).
  for (const p of periods) {
    const ys = events.filter((e) => e.period === p.id).map((e) => e.start);
    if (ys.some((y, i) => i && y < ys[i - 1])) problems.push(`${p.id}: events.json is not in chronological order`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ledger.reviewedThrough ?? "")) problems.push("ledger.json: reviewedThrough must be YYYY-MM-DD");
  for (const s of ledger.sources ?? []) if (!["reviewed", "unreviewed", "inaccessible"].includes(s.status)) problems.push(`ledger: ${s.ref}: status must be reviewed, unreviewed or inaccessible`);
  return { problems, events: events.length, drafts: drafts.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const corpus = loadCorpus(process.env.CJ_ROOT);
  const { problems, events, drafts } = checkAll({ corpus });
  for (const p of problems) console.log(p);
  console.log(`${events} event(s), ${drafts} draft(s), ${problems.length} problem(s)${corpus ? " (checked against the corpus)" : " (shape only: set CJ_ROOT to check against the corpus)"}`);
  process.exit(problems.length ? 1 : 0);
}
