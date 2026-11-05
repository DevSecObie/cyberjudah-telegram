// A case study reaches a timeline event only when it is about that event's own person. Two people
// who share a name (Lamech of Cain's line, Genesis 4:18; Lamech the father of Noah, Genesis 5:25)
// are told apart by person id, never by name. Each event below was checked against its dates and
// the verses of its case studies; a new attachment under a shared name must be checked the same way.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { flatten } from "../../shared/timeline.mjs";

const read = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), "utf8"));
const DATA = read("../src/data/timeline.json");
const CASES = read("../../bot/data/bs-timeline-cases.json");
const PEOPLE = read("../../bot/data/entities/people.json").entities;
const namesakes = new Map();
for (const p of Object.values(PEOPLE)) namesakes.set(p.name.toLowerCase(), (namesakes.get(p.name.toLowerCase()) ?? 0) + 1);

// Event slug -> the person id its case studies are about (verified 2026-11-05 against the event's years).
const VERIFIED = {
  adam: "adam-gen-2-19", cain: "cain-gen-4-1", abel: "abel-gen-4-2", enoch: "enoch-gen-5-18", noah: "noah-gen-5-29",
  ham: "ham-gen-5-32", job: "job-job-1-1", laban: "laban-gen-24-29", saul: "saul-1sa-9-2", jonathan: "jonathan-1sa-13-2",
  mephibosheth: "mephibosheth-2sa-4-4", amnon: "amnon-2sa-3-2", absalom: "absalom-2sa-3-3", ahab: "ahab-1ki-16-28",
  jehoshaphat: "jehoshaphat-1ki-15-24", elijah: "elijah-1ki-17-1", athaliah: "athaliah-2ki-8-26",
  "ahaziah-9th-king": "ahaziah-1ki-22-40", "ahaziah-6th-king": "ahaziah-2ki-8-24", jehoahaz: "jehoahaz-2ki-10-35",
  amaziah: "amaziah-2ki-12-21", jotham: "jotham-2ki-15-5", ahaz: "ahaz-2ki-15-38", hezekiah: "hezekiah-2ki-16-20",
  amon: "amon-2ki-21-18", josiah: "josiah-1ki-13-2", jeremiah: "jeremiah-2ch-35-25", daniel: "daniel-ezk-14-14",
  nehemiah: "nehemiah-neh-1-1",
};
// Never: the dated Lamech (3080-2303 BC, 777 years) is Noah's father, not Cain's descendant.
const NEVER = { lamech: ["lamech-gen-4-18"] };

test("a case under a shared name is attached only to its own person's event", () => {
  const seen = new Set();
  for (const e of flatten(DATA.sections)) {
    for (const c of e.cases ?? []) {
      const people = (CASES[c.slug]?.people ?? []).map((p) => p.id);
      for (const id of NEVER[e.slug] ?? []) assert.ok(!people.includes(id), `${e.slug} carries ${c.slug} (${id})`);
      const own = people.filter((id) => PEOPLE[id] && PEOPLE[id].name.toLowerCase() === e.title.toLowerCase());
      for (const id of own) {
        if ((namesakes.get(PEOPLE[id].name.toLowerCase()) ?? 0) < 2) continue;
        assert.equal(VERIFIED[e.slug], id, `${e.slug} <- ${c.slug}: ${id} shares a name; check it and list it`);
        seen.add(e.slug);
      }
    }
  }
  assert.ok(seen.size >= 20);
});
