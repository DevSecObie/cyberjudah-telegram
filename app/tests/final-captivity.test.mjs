import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { build, placeRows } from "../scripts/final-captivity/build.mjs";
import { checkAll, checkEvent, parseRef, seconds, words } from "../scripts/final-captivity/check.mjs";

const periods = JSON.parse(fs.readFileSync(new URL("../scripts/final-captivity/periods.json", import.meta.url), "utf8"));
const P = periods.periods;
const good = () => ({
  slug: "test-event", title: "A test event", start: 1441, end: 1444, date: { text: "1441–1444", precision: "year" },
  period: "into-the-ships", group: "Transatlantic trade", peoples: ["Black"], summary: "Documented.",
  account: ["Documented history."],
  teaching: [{ points: ["What the class taught."], source: { kind: "class", id: "bcDnpqS5WMA", title: "Vengeance", date: "2022-12-26", ts: "3:07:23", url: "https://youtu.be/bcDnpqS5WMA?t=11243" } }],
  scriptures: [{ ref: "Deuteronomy 28:68", why: "The ships." }],
  sources: [{ title: "A source", url: "https://example.org/a" }],
  status: "published",
});

test("the committed data passes its own check", () => {
  const { problems } = checkAll();
  assert.deepEqual(problems, []);
});

test("a complete event passes; each missing part is named", () => {
  assert.deepEqual(checkEvent(good(), P), []);
  const e = good(); delete e.teaching; e.sources = [];
  const p = checkEvent(e, P);
  assert.ok(p.some((x) => /missing teaching/.test(x)));
  assert.ok(p.some((x) => /missing sources/.test(x)));
});

test("years must sit inside the period; dates need a precision", () => {
  assert.ok(checkEvent({ ...good(), start: 1700, end: 1700 }, P).some((x) => /outside Into the Ships/.test(x)));
  assert.ok(checkEvent({ ...good(), date: { text: "1441" } }, P).some((x) => /precision/.test(x)));
});

test("a teaching moment links to the exact second it was taught", () => {
  assert.equal(seconds("3:07:23"), 11243);
  assert.equal(seconds("37:16"), 2236);
  const e = good(); e.teaching[0].source.url = "https://youtu.be/bcDnpqS5WMA";
  assert.ok(checkEvent(e, P).some((x) => /\?t=11243/.test(x)));
});

test("the teaching is said as the class's own understanding", () => {
  const e = good(); e.teaching[0].points = ["The teacher says the trade began in 1441."];
  assert.ok(checkEvent(e, P).some((x) => /class's understanding/.test(x)));
});

test("scripture references use the app's book names", () => {
  assert.deepEqual(parseRef("Deuteronomy 28:68"), { book: "Deuteronomy", chapter: 28, from: 68, to: 68 });
  assert.equal(parseRef("Deut 28:68"), null);
  assert.ok(checkEvent({ ...good(), scriptures: [{ ref: "Deut 28:68" }] }, P).some((x) => /not a reference/.test(x)));
});

test("a generated image says so; an archival one carries its rights", () => {
  assert.ok(checkEvent({ ...good(), image: { kind: "generated", src: "x.webp", caption: "A ship at sea" } }, P).some((x) => /say it is generated/.test(x)));
  assert.ok(checkEvent({ ...good(), image: { kind: "archival", src: "x.webp", caption: "A ship" } }, P).some((x) => /credit, licence/.test(x)));
});

test("a disagreement keeps both views", () => {
  assert.ok(checkEvent({ ...good(), disagreements: [{ point: "The year", views: ["1441"] }] }, P).some((x) => /two views/.test(x)));
});

test("quotes are matched by their words, as the captions write them", () => {
  assert.equal(words("“Not 1619 — it started 1441!”"), "not 1619 it started 1441");
  // Captions run a reference's numbers together: "deuteronomy 2868".
  assert.equal(words("Deuteronomy 28:68"), words("deuteronomy 2868"));
});

test("the build adds the age after the Reformation and keeps details out of the bars", () => {
  const timeline = { source: "x", reigns: "y", sections: [{ id: "12", title: "Reformation", events: [] }, { id: "fc-old", events: [] }] };
  const ledger = JSON.parse(fs.readFileSync(new URL("../scripts/final-captivity/ledger.json", import.meta.url), "utf8"));
  const out = build({ timeline, periods, events: [good()] });
  const ids = out.timeline.sections.map((s) => s.id);
  assert.deepEqual(ids, ["12", "fc-into-the-ships"], "periods without a published event are left out");
  assert.ok(out.timeline.sections.slice(1).every((s) => s.sectionTitle === "The Final Captivity"));
  const bar = out.timeline.sections[1].events[0];
  assert.equal(bar.fc, true);
  assert.equal(bar.account, undefined);
  assert.deepEqual(out.details["test-event"].account, ["Documented history."]);
  assert.equal(out.timeline.finalCaptivity.reviewedThrough, ledger.reviewedThrough);
});

test("bars that would overlap go on different rows", () => {
  const p = P[0];
  const rows = placeRows([{ start: 1441, end: 1441 }, { start: 1442, end: 1442 }, { start: 1500, end: 1500 }], p);
  assert.notEqual(rows[0], rows[1]);
  assert.equal(rows[2], rows[0]);
});
