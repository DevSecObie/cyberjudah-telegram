#!/usr/bin/env node
// Refreshes shared/holy-days.json from the IUIC calendar (https://israelunite.org/high-holy-days/calendar/):
// the feast days and New Moons on which Ask CyberJudah sells no top-ups (shared/holy-days.mjs).
//
//   node bot/scripts/holy-days.mjs [--since YYYY-MM-DD] [--summary changes.md]
//
// Run weekly by .github/workflows/holy-days.yml, which proposes any change as a pull request for
// the owner to approve; nothing reaches the app until it is merged.
//
// Each event on the site has numbered occurrences: /events/<slug>/var/ri-<n>.l-L1/ for n = 0, 1,
// 2, …, each page carrying its time as data-time="<start>-<end>" (Unix seconds). The occurrences
// are read until a page has no time, or shows the first occurrence's time again (the site's way
// of saying there are no more). They become daytime dates in the calendar's own zone (New York):
// - an event from one evening to the next is the daytime date it ends on; one that starts and
//   ends on the same date is that date;
// - a feast that runs several days pauses top-ups only on its opening and closing days (the
//   owner's rule: "opening and closing of feast weeks are no buying or selling");
// - dates follow the calendar as posted, even where it lists a day twice; the weekly refresh
//   picks up the site's own corrections.
// Only dates from today on are kept, so the file always looks forward.
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const EVENTS = {
  "passover-feast-of-unleavened-bread": "Passover / Feast of Unleavened Bread",
  purim: "Purim",
  nicanor: "Destruction of Nicanor",
  "feast-of-dedication": "Feast of Dedication",
  "feast-of-tabernacles": "Feast of Tabernacles",
  "day-of-atonement": "Day of Atonement",
  "memorial-blowing-of-trumpets": "Memorial Blowing of Trumpets",
  pentecost: "Pentecost",
  "day-of-simon": "Day of Simon",
  "new-moon": "New Moon",
};
export const SOURCE = "https://israelunite.org/high-holy-days/calendar/";
export const RULE = "Top-ups pause from full dark the evening before each date to full dark that evening. Feast weeks: opening and closing days only.";
const ZONE = "America/New_York";
const MAX_OCCURRENCES = 80;

/** The first occurrence time on an event page, as [start, end] Unix seconds, or null. */
export function parseTime(html) {
  const m = /data-time="(\d+)-(\d+)"/.exec(String(html ?? ""));
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** A moment's date and hour in the calendar's zone. */
function nyParts(sec) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", hourCycle: "h23" }).formatToParts(new Date(sec * 1000)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}
const addDays = (date, n) => { const [y, m, d] = date.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

/**
 * The daytime dates for the occurrences read ([{ slug, name, start, end }]), from `since` on:
 * { date, kind, name }, sorted, one per date and event.
 */
export function pickDays(events, since) {
  const days = new Map();
  for (const e of events) {
    const a = nyParts(e.start), b = nyParts(e.end);
    const kind = e.slug === "new-moon" ? "newmoon" : "feast";
    const first = a.hour >= 12 && b.date > a.date ? addDays(a.date, 1) : a.date;
    const last = e.end > e.start ? b.date : a.date;
    const span = daysBetween(first, last);
    const picks = span <= 0 ? [first] : [first, last];
    picks.forEach((date, i) => {
      if (date < since) return;
      const name = e.name + (span <= 0 ? "" : i === 0 ? " (opening day)" : " (closing day)");
      days.set(`${date}|${e.slug}`, { date, kind, name });
    });
  }
  return [...days.values()].sort((x, y) => x.date.localeCompare(y.date) || x.name.localeCompare(y.name));
}

/** What changed between two lists of days, by date: added, removed, and dates whose entries differ. */
export function compare(before, after) {
  const byDate = (list) => { const m = new Map(); for (const d of list) m.set(d.date, [...(m.get(d.date) ?? []), `${d.kind}: ${d.name}`].sort()); return m; };
  const b = byDate(before), a = byDate(after);
  const added = [...a.keys()].filter((d) => !b.has(d)).sort().map((d) => ({ date: d, entries: a.get(d) }));
  const removed = [...b.keys()].filter((d) => !a.has(d)).sort().map((d) => ({ date: d, entries: b.get(d) }));
  const changed = [...a.keys()].filter((d) => b.has(d) && JSON.stringify(a.get(d)) !== JSON.stringify(b.get(d))).sort().map((d) => ({ date: d, before: b.get(d), after: a.get(d) }));
  return { added, removed, changed };
}

/** The change as Markdown, for the pull request's description. */
export function summary(c) {
  const line = (x) => `- ${x.date}: ${x.entries.join("; ")}`;
  const parts = [];
  if (c.added.length) parts.push("**Added**", ...c.added.map(line), "");
  if (c.removed.length) parts.push("**Removed**", ...c.removed.map(line), "");
  if (c.changed.length) parts.push("**Changed**", ...c.changed.map((x) => `- ${x.date}: ${x.before.join("; ")} → ${x.after.join("; ")}`), "");
  return parts.length ? parts.join("\n") : "No dates changed.";
}

/** Every occurrence of every event, read from the site. A page that cannot be read stops the run: no half-read calendar is proposed. */
async function fetchEvents(get) {
  const out = [];
  for (const [slug, name] of Object.entries(EVENTS)) {
    let first = null;
    for (let ri = 0; ri < MAX_OCCURRENCES; ri++) {
      const t = parseTime(await get(`https://israelunite.org/events/${slug}/var/ri-${ri}.l-L1/`));
      if (!t) break;
      if (ri === 0) first = t;
      else if (t[0] === first[0] && t[1] === first[1]) break;
      out.push({ slug, name, ri, start: t[0], end: t[1] });
    }
    console.log(`${slug}: ${out.filter((o) => o.slug === slug).length}`);
  }
  return out;
}
async function get(url) {
  const res = await fetch(url, { headers: { "user-agent": "CyberJudah holy-days refresh (+https://cyberjudah.io)" } });
  if (res.status === 404) return "";
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

async function main() {
  const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
  const since = arg("--since") ?? nyParts(Date.now() / 1000).date;
  const file = new URL("../../shared/holy-days.json", import.meta.url);
  const before = JSON.parse(readFileSync(file, "utf8"));
  const days = pickDays(await fetchEvents(get), since);
  if (!days.length) throw new Error("The calendar gave no dates from today on: not written.");
  writeFileSync(file, `${JSON.stringify({ source: SOURCE, rule: RULE, days }, null, 1)}\n`);
  const c = compare((before.days ?? []).filter((d) => d.date >= since), days);
  const out = arg("--summary");
  if (out) writeFileSync(out, `${summary(c)}\n`);
  console.log(summary(c));
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main().catch((e) => { console.error(e.message); process.exit(1); });
