#!/usr/bin/env node
/**
 * Adds Between the Testaments (README.md here) to the Timeline, after The Exile and before
 * Life of Christ: its periods go into app/src/data/timeline.json as Bible Strong-shaped periods
 * (bars, rows, colour), and every published event's full content (account, teaching,
 * scriptures) goes to app/src/data/between-testaments.json, which the event sheet loads only
 * when one is opened.
 *
 * A period with no owner-approved boundary years yet (periods.json: startYear/endYear/interval
 * null) is left out of the live canvas entirely, same as a period with no published event
 * (app/scripts/final-captivity/build.mjs's own rule) — never an invented position for an
 * undated event. Only events.json is built; drafts never are.
 *
 * Run after timeline-data.mjs (it calls this) or on its own after editing events.json:
 * node app/scripts/between-testaments/build.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { placeRows } from "../final-captivity/build.mjs";
import { checkAll } from "./check.mjs";
import { loadCorpus } from "../final-captivity/check.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const TIMELINE = path.join(ROOT, "app/src/data/timeline.json");
const DETAILS = path.join(ROOT, "app/src/data/between-testaments.json");
const read = (f) => JSON.parse(fs.readFileSync(path.join(HERE, f), "utf8"));

/** The ID range kept for these events, clear of Bible Strong's and Final Captivity's (900000+). */
const ID_BASE = 800000;

export function build({ timeline, periods, events }) {
  const kept = timeline.sections.filter((s) => !String(s.id).startsWith("btt-"));
  const details = {};
  let n = 0;
  // A period shows once it has a published event and its own boundary years; never both an
  // invented position and a canvas with nothing on it.
  const sections = periods.periods
    .filter((p) => p.startYear != null && p.endYear != null && p.interval != null && events.some((e) => e.period === p.id))
    .map((p) => {
      const mine = events.filter((e) => e.period === p.id).sort((a, b) => a.start - b.start || a.end - b.end);
      const rows = placeRows(mine, p);
      return {
        id: `btt-${p.id}`, title: p.title, sectionTitle: periods.age, subTitle: p.subTitle,
        startYear: p.startYear, endYear: p.endYear, interval: p.interval, color: p.color,
        events: mine.map((e, i) => {
          const { slug, title, start, end, status, period, ...rest } = e; // eslint-disable-line no-unused-vars
          details[slug] = { ...rest, title, start, end, period };
          return { id: ID_BASE + n++, slug, title, start, end, row: rows[i], type: "major", ...(e.date?.precision === "circa" ? { approx: true } : {}), btt: true, ...(e.group ? { group: e.group } : {}) };
        }),
      };
    });
  // Spliced in right after The Exile (id "8") and before Life of Christ (id "9"), not appended
  // at the end: this age sits inside ancient history, not after it. If Bible Strong's section
  // ids or titles ever change, silently appending at the end would be worse than failing loud.
  const exileIndex = kept.findIndex((s) => s.id === "8" && s.title === "The Exile");
  if (exileIndex === -1) throw new Error('Between the Testaments: no section with id "8" and title "The Exile" to splice after; check app/src/data/timeline.json');
  const nextSection = kept[exileIndex + 1];
  if (nextSection?.id !== "9" || nextSection.title !== "Life of Christ") {
    throw new Error(`Between the Testaments: expected id "9" title "Life of Christ" right after The Exile, found ${nextSection ? `id "${nextSection.id}" title "${nextSection.title}"` : "nothing"}`);
  }
  const at = exileIndex + 1;
  return { timeline: { ...timeline, sections: [...kept.slice(0, at), ...sections, ...kept.slice(at)] }, details };
}

/** Checks the data, then writes the Timeline's period (once it has one) and the details file. Throws on any problem. */
export function writeBetweenTestaments() {
  const { problems } = checkAll({ corpus: loadCorpus(process.env.CJ_ROOT) });
  if (problems.length) throw new Error(`Between the Testaments: ${problems.length} problem(s), run check.mjs:\n${problems.join("\n")}`);
  const out = build({ timeline: JSON.parse(fs.readFileSync(TIMELINE, "utf8")), periods: read("periods.json"), events: read("events.json") });
  fs.writeFileSync(TIMELINE, JSON.stringify(out.timeline) + "\n");
  fs.writeFileSync(DETAILS, JSON.stringify(out.details) + "\n");
  const live = out.timeline.sections.filter((s) => String(s.id).startsWith("btt-"));
  return live.length ? live.map((s) => `${s.title}: ${s.events.length}`) : ["pending (no boundary years cited yet)"];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { console.log(`Between the Testaments: ${writeBetweenTestaments().join(", ")}`); } catch (e) { console.error(e.message); process.exit(1); }
}
