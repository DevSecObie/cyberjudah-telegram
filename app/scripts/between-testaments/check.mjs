#!/usr/bin/env node
/**
 * Checks Between the Testaments' data (README.md here) before it is built.
 *
 *   node app/scripts/between-testaments/check.mjs            the shape, dates and rules
 *   CJ_ROOT=../cyberjudah node …/check.mjs                    also against the corpus: every
 *                                                             cited recording exists, its moment
 *                                                             is inside it, every quote is in the
 *                                                             recording in the ten minutes from
 *                                                             that moment, every scripture is a
 *                                                             real verse
 *
 * Prints each problem and exits 1 if there is any. Drafts are checked for shape only (no leader
 * concept here, unlike Final Captivity: this period names no IUIC leader).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { timelineSchema } from "../../../shared/cms.ts";
import { checkEvent } from "../../../shared/cms-timeline-rules.mjs";
import { loadCorpus } from "../final-captivity/check.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => JSON.parse(fs.readFileSync(path.join(HERE, f), "utf8"));

export function checkAll({ corpus } = {}) {
  const { periods } = read("periods.json");
  const events = read("events.json");
  const drafts = read("drafts.json");
  const problems = [];
  const seen = new Set();
  for (const [list, draft] of [[events, false], [drafts, true]]) {
    for (const e of list) {
      if (seen.has(e.slug)) problems.push(`${e.slug}: slug used twice`);
      seen.add(e.slug);
      const shape = timelineSchema(periods, [], draft).safeParse(e);
      if (!shape.success) problems.push(...shape.error.issues.map((i) => `${e.slug}: ${i.path.join(".")}: ${i.message}`));
      else if (corpus) problems.push(...checkEvent(e, periods, { corpus, draft, leaders: [] }));
    }
  }
  // A period only reaches the live canvas once it has owner-approved boundary years (build.mjs
  // leaves an empty-bounds period out of app/src/data/timeline.json); a published event under
  // one is a sign the boundary years were meant to be filled in first.
  for (const p of periods) {
    if (p.startYear == null && events.some((e) => e.period === p.id)) problems.push(`${p.id}: has a published event but no boundary years yet; cite them in periods.json first`);
    const ys = events.filter((e) => e.period === p.id).map((e) => e.start);
    if (ys.some((y, i) => i && y < ys[i - 1])) problems.push(`${p.id}: events.json is not in chronological order`);
  }
  return { problems, events: events.length, drafts: drafts.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const corpus = loadCorpus(process.env.CJ_ROOT);
  const { problems, events, drafts } = checkAll({ corpus });
  for (const p of problems) console.log(p);
  console.log(`${events} event(s), ${drafts} draft(s), ${problems.length} problem(s)${corpus ? " (checked against the corpus)" : " (shape only: set CJ_ROOT to check against the corpus)"}`);
  process.exit(problems.length ? 1 : 0);
}
