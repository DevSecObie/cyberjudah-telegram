import { test } from "node:test";
import assert from "node:assert/strict";
import { coordsOf, DEFAULT_ZONE, eveOfHolyDay, fullDark, fullDarkIn, HOLY_DAYS, holyDay, pauseMessage, topupPause, zoneOf } from "../../shared/holy-days.mjs";
import { compare, parseTime, pickDays, summary } from "../scripts/holy-days.mjs";

const at = (iso) => Date.parse(iso);
const near = (ms, iso, minutes, what) => assert.ok(Math.abs(ms - at(iso)) <= minutes * 60000, `${what}: ${new Date(ms).toISOString()} is not within ${minutes} min of ${iso}`);

test("full dark is the end of astronomical twilight, within a few minutes of the published times", () => {
  // New York (40.71 N, 74.01 W): astronomical twilight ends about 8:40 pm EDT at the March equinox,
  // 10:37 pm EDT at the June solstice and 6:11 pm EST at the December solstice. The reference times
  // here agree, to the minute, with two independent implementations (Python's astral, which follows
  // the NOAA Solar Calculator, and SunCalc, which follows Astronomy Answers).
  near(fullDark("2026-03-20", 40.71, -74.01).at, "2026-03-21T00:40:00Z", 3, "New York, March 20");
  near(fullDark("2026-06-21", 40.71, -74.01).at, "2026-06-22T02:37:00Z", 3, "New York, June 21");
  near(fullDark("2026-12-21", 40.71, -74.01).at, "2026-12-21T23:11:00Z", 3, "New York, December 21");
  // East of Greenwich and south of the equator: Sydney in its summer, 8:49 pm AEDT.
  near(fullDark("2026-01-15", -33.87, 151.21).at, "2026-01-15T10:49:00Z", 3, "Sydney, January 15");
  // Lagos, near the equator: 7:46 pm WAT.
  near(fullDark("2026-10-02", 6.45, 3.4).at, "2026-10-02T18:46:30Z", 3, "Lagos, October 2");
});

test("where the sky never loses its blue (high summer at high latitude), the darkest moment of the night is used", () => {
  // London never reaches astronomical night around the June solstice: solar midnight is about 1:02 am BST.
  const london = fullDark("2026-06-21", 51.51, -0.13);
  assert.equal(london.deepest, true);
  near(london.at, "2026-06-22T00:02:00Z", 5, "London solar midnight");
  // Reykjavík likewise.
  assert.equal(fullDark("2026-06-21", 64.15, -21.94).deepest, true);
  // In winter the same place has a real astronomical dusk.
  assert.equal(fullDark("2026-12-21", 51.51, -0.13).deepest, false);
});

test("a time zone gives its principal place; an unknown one falls back to New York", () => {
  assert.deepEqual(coordsOf("America/New_York"), [40.71, -74.01]);
  assert.deepEqual(coordsOf("Asia/Calcutta"), coordsOf("Asia/Kolkata"));
  assert.equal(zoneOf("Mars/Olympus_Mons"), DEFAULT_ZONE);
  assert.equal(zoneOf(undefined), DEFAULT_ZONE);
  assert.equal(zoneOf("Europe/London"), "Europe/London");
});

test("the Sabbath: top-ups pause from full dark on Friday to full dark on Saturday, where the reader is", () => {
  const none = [];
  const friDark = fullDarkIn("2026-10-30", "America/New_York");
  const satDark = fullDarkIn("2026-10-31", "America/New_York");
  // Friday afternoon: still open.
  assert.equal(topupPause(at("2026-10-30T22:00:00Z"), "America/New_York", none), null);
  // Friday 9:30 pm EDT, after full dark: paused until Saturday's full dark.
  const p = topupPause(at("2026-10-31T01:30:00Z"), "America/New_York", none);
  assert.equal(p?.kind, "sabbath");
  assert.equal(p.from, friDark);
  assert.equal(p.until, satDark);
  assert.equal(pauseMessage(p), "Top-ups pause for the Sabbath — they open again after dark on Saturday");
  // Saturday noon: still paused. Saturday after full dark: open again.
  assert.ok(topupPause(at("2026-10-31T16:00:00Z"), "America/New_York", none));
  assert.equal(topupPause(satDark + 60000, "America/New_York", none), null);
  assert.equal(topupPause(satDark - 60000, "America/New_York", none)?.kind, "sabbath");
  // The same moment is still Friday afternoon in Los Angeles: open there.
  assert.equal(topupPause(at("2026-10-31T01:30:00Z"), "America/Los_Angeles", none), null);
});

test("a day in holy-days.json pauses top-ups from full dark the evening before to full dark on its own evening", () => {
  // The Day of Atonement, Tuesday 6 October 2026, from the IUIC calendar.
  assert.ok(HOLY_DAYS.some((d) => d.date === "2026-10-06" && d.kind === "feast"));
  assert.equal(holyDay("2026-10-06")?.kind, "feast");
  assert.equal(topupPause(at("2026-10-05T20:00:00Z"), "America/New_York"), null, "Monday afternoon is open");
  const p = topupPause(at("2026-10-06T02:30:00Z"), "America/New_York");
  assert.equal(p?.kind, "feast");
  assert.equal(pauseMessage(p), "Top-ups pause for the feast day — they open again after dark on Tuesday");
  assert.equal(topupPause(at("2026-10-07T03:00:00Z"), "America/New_York"), null, "Tuesday after dark is open");
  // A New Moon.
  assert.match(pauseMessage(topupPause(at("2026-10-27T16:00:00Z"), "America/New_York")), /^Top-ups pause for the New Moon — they open again after dark on Tuesday$/);
});

test("days that follow one another pause as one: a feast day on Friday runs on into the Sabbath", () => {
  const days = [{ date: "2026-10-30", kind: "feast", name: "A feast" }];
  const p = topupPause(at("2026-10-29T23:30:00Z"), "America/New_York", days);
  assert.equal(p?.kind, "feast");
  assert.equal(p.until, fullDarkIn("2026-10-31", "America/New_York"));
});

test("the top-up reminder goes on the day before a holy day, not on a holy day itself", () => {
  assert.equal(eveOfHolyDay(at("2026-10-30T16:00:00Z"), "America/New_York", [])?.kind, "sabbath");
  assert.equal(eveOfHolyDay(at("2026-10-29T16:00:00Z"), "America/New_York", []), null);
  const days = [{ date: "2026-10-30", kind: "feast", name: "A feast" }];
  assert.equal(eveOfHolyDay(at("2026-10-29T16:00:00Z"), "America/New_York", days)?.kind, "feast");
  assert.equal(eveOfHolyDay(at("2026-10-30T16:00:00Z"), "America/New_York", days), null, "Friday is itself a feast: top-ups are already paused");
});

// The weekly refresh (bot/scripts/holy-days.mjs), against occurrences as the IUIC site gives them.
const EVENTS = [
  { slug: "day-of-atonement", name: "Day of Atonement", start: 1791241140, end: 1791323940 },
  { slug: "feast-of-tabernacles", name: "Feast of Tabernacles", start: 1791673140, end: 1792277940 },
  { slug: "new-moon", name: "New Moon", start: 1793052000, end: 1793141940 },
  // An occurrence with no length (its end before its start), and one in the past.
  { slug: "nicanor", name: "Destruction of Nicanor", start: 1804201200, end: 1804201140 },
  { slug: "new-moon", name: "New Moon", start: 1775167200, end: 1775253540 },
];

test("an event page's time is read from its first data-time", () => {
  assert.deepEqual(parseTime('<div class="x" data-time="1791241140-1791323940">Oct 5</div><span data-time="1-2">'), [1791241140, 1791323940]);
  assert.equal(parseTime("<html>No events</html>"), null);
  assert.equal(parseTime(undefined), null);
});

test("occurrences become daytime dates in New York; a feast week keeps its opening and closing days; the past is dropped", () => {
  assert.deepEqual(pickDays(EVENTS, "2026-10-03"), [
    { date: "2026-10-06", kind: "feast", name: "Day of Atonement" },
    { date: "2026-10-11", kind: "feast", name: "Feast of Tabernacles (opening day)" },
    { date: "2026-10-17", kind: "feast", name: "Feast of Tabernacles (closing day)" },
    { date: "2026-10-27", kind: "newmoon", name: "New Moon" },
    { date: "2027-03-04", kind: "feast", name: "Destruction of Nicanor" },
  ]);
});

test("the pull request lists what was added, removed and changed, by date", () => {
  const before = [{ date: "2026-10-06", kind: "feast", name: "Day of Atonement" }, { date: "2026-10-20", kind: "newmoon", name: "New Moon" }];
  const after = [{ date: "2026-10-06", kind: "feast", name: "Day of Atonement (corrected)" }, { date: "2026-10-27", kind: "newmoon", name: "New Moon" }];
  const c = compare(before, after);
  assert.deepEqual(c.added.map((x) => x.date), ["2026-10-27"]);
  assert.deepEqual(c.removed.map((x) => x.date), ["2026-10-20"]);
  assert.deepEqual(c.changed.map((x) => x.date), ["2026-10-06"]);
  assert.match(summary(c), /\*\*Added\*\*\n- 2026-10-27: newmoon: New Moon/);
  assert.equal(summary(compare(before, before)), "No dates changed.");
});
