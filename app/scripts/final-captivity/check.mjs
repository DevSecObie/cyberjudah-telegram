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

import { timelineSchema } from "../../../shared/cms.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => JSON.parse(fs.readFileSync(path.join(HERE, f), "utf8"));

import { checkEvent, words, parseRef } from "../../../shared/cms-timeline-rules.mjs";
export { checkEvent, words, parseRef, seconds, GROUPS, TRIBES, PEOPLES, BOOKS } from "../../../shared/cms-timeline-rules.mjs";

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
      const shape = timelineSchema(periods, leaders, draft).safeParse(e);
      if (!shape.success) problems.push(...shape.error.issues.map(i => `${e.slug}: ${i.path.join(".")}: ${i.message}`));
      else if (corpus) problems.push(...checkEvent(e, periods, { corpus, draft, leaders }));
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
