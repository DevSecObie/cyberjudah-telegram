#!/usr/bin/env node
/**
 * Builds app/src/data/timeline.json, the Timeline's data, from two sources:
 *
 *  - Bible Strong's timeline (strong/apps/expo/src/assets/timeline/events.txt): its periods and
 *    events with their years and rows, which the Timeline lays out exactly as Bible Strong does.
 *    Only the history is kept (titles, years, rows, colours). Their descriptions, articles,
 *    pictures and French fields are left out, and so is their prophetic teaching: the last
 *    period ("Revelation Prophecies") and every prophecy-interpretation event (DOCTRINE below).
 *  - Our case studies (a built data set's api/cases: index.json and <slug>.json): a case is
 *    attached to an event only on an unambiguous match. Its name equals the event's title, or
 *    one of its people's names does, and exactly one kept event has that title. Nothing is
 *    matched by similarity; an ambiguous name is skipped and reported.
 *
 * Usage: node app/scripts/timeline-data.mjs <cases dir or URL>   (e.g. ../cyberjudah/dist/api/cases
 *        or https://data.cyberjudah.io/api/cases). Re-run when either source changes.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SOURCE = path.join(ROOT, "strong/apps/expo/src/assets/timeline/events.txt");
const OUT = path.join(ROOT, "app/src/data/timeline.json");
/** People with an approved portrait that the timeline may show (app/public/people/<id>-<size>.webp). */
const PORTRAITS = path.join(ROOT, "app/scripts/timeline-portraits.json");
/** The kings' reigns from Who's Who in the Bible (its Chronology), as facts: name, kingdom, years BC. */
const REIGNS = path.join(ROOT, "app/scripts/whoswho-reigns.json");

/**
 * Their prophetic interpretation (the 2300 days, the beasts, the church ages, the end of
 * time): doctrine, not history. A prophecy that is itself an event in the text (Isaiah naming
 * Cyrus) is history and stays.
 */
export const DOCTRINE = /prophec|beast|three angels|church of (ephesus|smyrna|pergamos|thyatira|sardis|philadelphia|laodicea)|millennium|seven seals|deadly wound|close of probation|sanctuary|seventy-weeks|\b(2300|1260|1290|1335)\b/i;
const NOT_DOCTRINE = new Set(["Isaiah Prophecy Concerning Cyrus II"]);
const isDoctrine = (title) => DOCTRINE.test(title) && !NOT_DOCTRINE.has(title.trim());
const DOCTRINE_SECTIONS = new Set(["13"]);

export const norm = (t) => String(t).toLowerCase().replace(/[’']/g, "'").replace(/^the /, "").replace(/[^a-z0-9' ]/g, " ").replace(/\s+/g, " ").trim();

/** The kept periods and events, as Bible Strong lays them out. */
export function keepHistory(sections) {
  const dropped = [];
  const kept = sections.filter((s) => !DOCTRINE_SECTIONS.has(String(s.id))).map((s) => ({
    id: String(s.id), title: s.titleEn, sectionTitle: s.sectionTitleEn, subTitle: s.subTitleEn,
    startYear: s.startYear, endYear: s.endYear, interval: s.interval, color: s.color,
    events: s.events.filter((e) => { const doctrine = isDoctrine(e.titleEn); if (doctrine) dropped.push(e.titleEn); return !doctrine; })
      .map((e) => ({ id: e.id, slug: e.slug, title: e.titleEn.trim(), start: e.start, end: e.end, row: e.row, type: e.type, ...(e.approx ? { approx: true } : {}), ...(e.isFixed ? { isFixed: true } : {}) })),
  }));
  return { kept, dropped: [...new Set(dropped)], droppedSections: sections.filter((s) => DOCTRINE_SECTIONS.has(String(s.id))).map((s) => s.titleEn) };
}

/**
 * Each reign in Who's Who goes to the one Bible Strong event of that name whose years hold
 * it (their king events span a life; the reign falls inside). Events taken by a sure match
 * are set aside first, so two kings of one name (Ahaziah of Israel and of Judah) separate
 * by their years. A reign that still fits more than one event, or none, is left off.
 */
export function attachReigns(sections, reigns) {
  const events = new Map();
  for (const s of sections) for (const e of s.events) (events.get(e.slug) ?? events.set(e.slug, []).get(e.slug)).push(e);
  const candidates = (r) => [...events.values()].filter(([e]) => norm(e.title) === norm(r.name) && e.start <= -r.from && e.end >= -r.to);
  const taken = new Set(), placed = new Map(), unplaced = [];
  let pending = [...reigns], progress = true;
  while (pending.length && progress) {
    progress = false;
    pending = pending.filter((r) => {
      const c = candidates(r).filter(([e]) => !taken.has(e.slug));
      if (c.length !== 1) return true;
      taken.add(c[0][0].slug); placed.set(`${norm(r.name)}|${r.kingdom}`, c[0][0].slug);
      for (const e of c[0]) e.reign = { kingdom: r.kingdom, from: r.from, to: r.to, ...(r.approx ? { approx: true } : {}) };
      progress = true;
      return false;
    });
  }
  unplaced.push(...pending.map((r) => `${r.name} of ${r.kingdom}`));
  return { placed, unplaced };
}

/**
 * Our cases attached to events. A case goes to an event when:
 *  - its name is the event's title, and only one event has that title; or
 *  - it is "X of Israel/Judah" and X's reign in that kingdom was placed on an event; or
 *  - one of its people is that event's person: the same person (by id) as a case of the
 *    event's own name, or the only person of that name in our people index. Two people
 *    who share a name (Ahab the king, Ahab the son of Kolaiah) are never confused.
 */
export function attachCases(sections, cases, kings = new Map(), peopleIndex = []) {
  const slugsOf = new Map(), copies = new Map();
  for (const s of sections) for (const e of s.events) {
    const k = norm(e.title);
    (slugsOf.get(k) ?? slugsOf.set(k, new Set()).get(k)).add(e.slug);
    (copies.get(e.slug) ?? copies.set(e.slug, []).get(e.slug)).push(e);
  }
  // Bible Strong repeats an event (the same slug) in neighbouring periods: one event.
  const byTitle = new Map([...slugsOf].map(([k, slugs]) => [k, slugs.size === 1 ? [...slugs][0] : null]));
  const namesake = new Map();
  for (const p of peopleIndex) { const k = norm(p.name); namesake.set(k, (namesake.get(k) ?? 0) + 1); }
  const ambiguous = new Set();
  const attach = (slug, c) => copies.get(slug).forEach((e) => { e.cases ??= []; if (!e.cases.some((x) => x.slug === c.slug)) e.cases.push({ slug: c.slug, name: c.name, kind: c.kind ?? "judgment" }); });

  // Pass 1: by the case's own name (or king's reign); the people of such a case are that event's people.
  const personEvent = new Map();
  const rest = [];
  for (const c of cases) {
    const king = /^(.+) of (Israel|Judah)$/.exec(c.name);
    let slug = king ? kings.get(`${norm(king[1])}|${king[2]}`) : undefined;
    if (!slug) {
      const k = norm(c.name);
      if (byTitle.has(k)) { slug = byTitle.get(k); if (!slug) ambiguous.add(c.name); }
    }
    if (!slug) { rest.push(c); continue; }
    attach(slug, c);
    const who = (c.people ?? []).filter((p) => norm(p.name) === norm(king ? king[1] : c.name));
    if (who.length === 1) personEvent.set(who[0].id, slug);
  }
  // Pass 2: by the people in the case, each known to be the event's person.
  for (const c of rest) for (const p of c.people ?? []) {
    let slug = personEvent.get(p.id);
    if (!slug && namesake.get(norm(p.name)) === 1 && byTitle.has(norm(p.name))) slug = byTitle.get(norm(p.name));
    if (slug) attach(slug, c);
  }
  return { ambiguous: [...ambiguous].sort(), personEvent };
}

/**
 * The approved People portrait (docs/AVATARS.md) of the person an event is about, by person id:
 * the person a case study already ties to the event, or the only person of the event's name in
 * our people index. Nobody is matched by likeness of name, and a name two people share gets none.
 * `notOn` lists events whose case-study person is not the event's person (see the JSON).
 */
export function attachPortraits(sections, approved, personEvent, peopleIndex = [], notOn = {}) {
  const byName = new Map();
  for (const p of peopleIndex) { const k = norm(p.name); byName.set(k, byName.has(k) ? null : p.id); }
  const placed = new Map();
  for (const [id, slug] of personEvent) if (approved.has(id)) placed.set(slug, id);
  for (const s of sections) for (const e of s.events) {
    if (placed.has(e.slug)) continue;
    const id = byName.get(norm(e.title));
    if (id && approved.has(id)) placed.set(e.slug, id);
  }
  for (const slug of Object.keys(notOn)) placed.delete(slug);
  for (const s of sections) for (const e of s.events) if (placed.has(e.slug)) e.portrait = placed.get(e.slug);
  return placed;
}

async function readPeople(src) {
  try { return /^https?:/.test(src) ? await (await fetch(`${src.replace(/\/cases\/?$/, "")}/people/index.json`)).json() : JSON.parse(fs.readFileSync(path.join(src, "..", "people", "index.json"), "utf8")); }
  catch { return []; }
}

async function readCases(src) {
  const get = async (p) => (/^https?:/.test(src) ? (await fetch(`${src}/${p}`)).json() : JSON.parse(fs.readFileSync(path.join(src, p), "utf8")));
  const index = await get("index.json");
  const out = [];
  for (const c of index.cases) { try { const full = await get(`${c.slug}.json`); out.push({ ...c, people: full.people ?? [] }); } catch { out.push(c); } }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const src = process.argv[2];
  if (!src) { console.error("usage: node app/scripts/timeline-data.mjs <cases dir or URL>"); process.exit(1); }
  const { kept, dropped, droppedSections } = keepHistory(JSON.parse(fs.readFileSync(SOURCE, "utf8")));
  const cases = await readCases(src);
  const reigns = JSON.parse(fs.readFileSync(REIGNS, "utf8"));
  const { placed, unplaced } = attachReigns(kept, reigns.reigns);
  const people = await readPeople(src);
  const { ambiguous, personEvent } = attachCases(kept, cases, placed, people);
  const approved = JSON.parse(fs.readFileSync(PORTRAITS, "utf8"));
  const portraits = attachPortraits(kept, new Set(approved.ids), personEvent, people, approved.notOn);
  const attached = new Set(kept.flatMap((s) => s.events.flatMap((e) => (e.cases ?? []).map((c) => c.slug))));
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ source: "Bible Strong timeline (events.txt), history only; case studies attached by exact name", reigns: reigns.source, sections: kept }) + "\n");
  console.log(JSON.stringify({ periods: kept.length, events: kept.reduce((n, s) => n + s.events.length, 0), droppedSections, droppedEvents: dropped.length, casesAttached: attached.size, casesTotal: cases.length, ambiguous, reignsPlaced: placed.size, reignsUnplaced: unplaced, portraits: Object.fromEntries(portraits) }, null, 1));
  if (process.env.VERBOSE) console.log(dropped.join("\n"));
}
