#!/usr/bin/env node
// Builds shared/zone-coords.json: each IANA time zone's principal place, as [latitude, longitude],
// from the tz database's own tables. Ask uses it to know when full dark falls for a reader, from
// nothing but the time zone their device reports (shared/holy-days.mjs): no location is asked for.
//
//   node bot/scripts/zone-coords.mjs [/usr/share/zoneinfo]
//
// zone1970.tab and zone.tab give each zone's coordinates (ISO 6709); tzdata.zi's links ("L target
// link") give the older and alias names (Asia/Calcutta, US/Eastern, Europe/Oslo) the coordinates
// of the zone they point to, unless zone.tab gives them their own.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const dir = process.argv[2] ?? "/usr/share/zoneinfo";
const read = (f) => (existsSync(`${dir}/${f}`) ? readFileSync(`${dir}/${f}`, "utf8") : "");

/** ±DDMM[SS]±DDDMM[SS] to decimal degrees, two places (about a kilometre: plenty for dusk). */
function iso6709(s) {
  const m = /^([+-])(\d{2})(\d{2})(\d{2})?([+-])(\d{3})(\d{2})(\d{2})?$/.exec(s);
  if (!m) return null;
  const deg = (sign, d, mi, se) => (sign === "-" ? -1 : 1) * (Number(d) + Number(mi) / 60 + Number(se ?? 0) / 3600);
  const r = (x) => Math.round(x * 100) / 100;
  return [r(deg(m[1], m[2], m[3], m[4])), r(deg(m[5], m[6], m[7], m[8]))];
}

const zones = {};
for (const file of ["zone1970.tab", "zone.tab"]) {
  for (const line of read(file).split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const [, coord, tz] = line.split("\t");
    const c = coord && iso6709(coord);
    if (tz && c && !zones[tz]) zones[tz] = c;
  }
}
if (!Object.keys(zones).length) { console.error(`No zone1970.tab or zone.tab in ${dir}`); process.exit(1); }
let links = 0;
for (const line of read("tzdata.zi").split("\n")) {
  const m = /^L (\S+) (\S+)$/.exec(line);
  if (m && zones[m[1]] && !zones[m[2]]) { zones[m[2]] = zones[m[1]]; links++; }
}
const sorted = Object.fromEntries(Object.keys(zones).sort().map((k) => [k, zones[k]]));
const version = (read("tzdata.zi").match(/^# version (\S+)/m) ?? [])[1] ?? "unknown";
const out = new URL("../../shared/zone-coords.json", import.meta.url);
writeFileSync(out, `${JSON.stringify({ source: `IANA tz database ${version}: zone1970.tab, zone.tab and tzdata.zi links (bot/scripts/zone-coords.mjs)`, zones: sorted })}\n`);
console.log(`${Object.keys(sorted).length} zones (${links} by link) → ${out.pathname}`);
