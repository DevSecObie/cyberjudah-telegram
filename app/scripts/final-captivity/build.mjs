#!/usr/bin/env node
/**
 * Adds The Final Captivity (README.md here) to the Timeline: its periods go after the
 * Reformation in app/src/data/timeline.json as Bible Strong-shaped periods (bars, rows, colour),
 * and every event's full content (account, teaching, scriptures, sources) goes to
 * app/src/data/final-captivity.json, which the event sheet loads only when one is opened.
 *
 * Only events.json is built; drafts never are. Run after timeline-data.mjs (it calls this) or
 * on its own after editing events.json: node app/scripts/final-captivity/build.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { geometry } from "../../../shared/timeline.mjs";
import { checkAll, loadCorpus } from "./check.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const TIMELINE = path.join(ROOT, "app/src/data/timeline.json");
const DETAILS = path.join(ROOT, "app/src/data/final-captivity.json");
const read = (f) => JSON.parse(fs.readFileSync(path.join(HERE, f), "utf8"));

/** Rows filled from the middle outwards, as Bible Strong's busiest periods read. */
const ROW_ORDER = [12, 10, 14, 8, 16, 6, 18, 4, 20, 2, 22, 11, 13, 9, 15, 7, 17, 5, 19, 3, 21, 1, 23, 0];
const GAP = 16;
/** The width a bar takes on the canvas: Bible Strong's (200px at least) at a 390px phone. */
export function placeRows(events, period, viewport = 390) {
  const g = geometry(period, viewport);
  const ends = new Map();
  return events.map((e) => {
    const left = g.yearsToPx(e.start);
    const right = left + g.eventWidth(e.start, e.end, false);
    const row = ROW_ORDER.find((r) => (ends.get(r) ?? -Infinity) + GAP <= left) ?? ROW_ORDER[0];
    ends.set(row, right);
    return row;
  });
}

/** The ID range kept for these events, clear of Bible Strong's. */
const ID_BASE = 900000;

export function build({ timeline, periods, events }) {
  const kept = timeline.sections.filter((s) => !String(s.id).startsWith("fc-"));
  const details = {};
  let n = 0;
  // A period shows once it has a published event; an empty canvas is left out.
  const sections = periods.periods.filter((p) => events.some((e) => e.period === p.id)).map((p) => {
    const mine = events.filter((e) => e.period === p.id).sort((a, b) => a.start - b.start || a.end - b.end);
    const rows = placeRows(mine, p);
    return {
      id: `fc-${p.id}`, title: p.title, sectionTitle: periods.age, subTitle: p.subTitle,
      startYear: p.startYear, endYear: p.endYear, interval: p.interval, color: p.color,
      events: mine.map((e, i) => {
        const { slug, title, start, end, status, period, ...rest } = e; // eslint-disable-line no-unused-vars
        details[slug] = { ...rest, title, start, end, period };
        return { id: ID_BASE + n++, slug, title, start, end, row: rows[i], type: "major", ...(e.date?.precision === "circa" ? { approx: true } : {}), fc: true, group: e.group };
      }),
    };
  });
  return { timeline: { ...timeline, finalCaptivity: { age: periods.age, reviewedThrough: read("ledger.json").reviewedThrough }, sections: [...kept, ...sections] }, details };
}

/** Checks the data, then writes the Timeline's periods and the details file. Throws on any problem. */
export function writeFinalCaptivity() {
  const { problems } = checkAll({ corpus: loadCorpus(process.env.CJ_ROOT) });
  if (problems.length) throw new Error(`The Final Captivity: ${problems.length} problem(s), run check.mjs:\n${problems.join("\n")}`);
  const out = build({ timeline: JSON.parse(fs.readFileSync(TIMELINE, "utf8")), periods: read("periods.json"), events: read("events.json") });
  fs.writeFileSync(TIMELINE, JSON.stringify(out.timeline) + "\n");
  fs.writeFileSync(DETAILS, JSON.stringify(out.details) + "\n");
  return out.timeline.sections.filter((s) => String(s.id).startsWith("fc-")).map((s) => `${s.title}: ${s.events.length}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { console.log(`The Final Captivity: ${writeFinalCaptivity().join(", ")}`); } catch (e) { console.error(e.message); process.exit(1); }
}
