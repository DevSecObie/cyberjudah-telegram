import test from "node:test";
import assert from "node:assert/strict";
import { seriesLabel, seriesOf } from "../src/lib/series.ts";

const label = (titles) => Object.fromEntries([...seriesOf(titles)].map(([t, s]) => [t, seriesLabel(s)]));

test("a numbered part names its run, and the unnumbered class is part 1", () => {
  assert.deepEqual(label(["Leaven: The Root of Bitterness", "Leaven: The Root of Bitterness Part 2", "Kill Or Be Killed"]), {
    "Leaven: The Root of Bitterness Part 2": "Leaven: The Root of Bitterness · Part 2",
    "Leaven: The Root of Bitterness": "Leaven: The Root of Bitterness · Part 1",
  });
  assert.deepEqual(label(["Member's In The Body", "Members of the Body  Pt2"]), {
    "Members of the Body  Pt2": "Members of the Body · Part 2",
    "Member's In The Body": "Members of the Body · Part 1",
  });
  assert.equal(label(["When Children Walk in a Land of Shadows (Part 2)"])["When Children Walk in a Land of Shadows (Part 2)"], "When Children Walk in a Land of Shadows · Part 2");
});

test("parts worded a little differently are one run", () => {
  const l = label(["Transforming from Immorality into Beautiful Civility Part 2", "Transforming From Immorality To Beautiful Civility Returning Our Kingdom To An Organized Nation Pt 3"]);
  assert.deepEqual(Object.values(l), ["Transforming from Immorality into Beautiful Civility · Part 2", "Transforming from Immorality into Beautiful Civility · Part 3"]);
});

test("a heading two classes share is their series", () => {
  const l = label([
    "Navigating Through Paul's Letters: Walk Through of Romans 5",
    "Navigating Through Paul's Letters: Walking Through Galatians",
    "The Vantage Point of the Elders: the Fathers Have Spoken",
    "The Vantage Point of the Elders & Fathers: the Children Are Listening",
  ]);
  assert.deepEqual(Object.values(l), ["Navigating Through Paul's Letters", "Navigating Through Paul's Letters", "The Vantage Point of the Elders", "The Vantage Point of the Elders"]);
});

test("a one-word subject, a lone heading or a subtitle is not a series", () => {
  assert.deepEqual(label([
    "Edom: The Greatly Despised", "Edom: The Robbers of thy people revealed past and present",
    "Jubilee: The Year To Be Set Free",
    "Agree Together | Bound Not Bondage",
    "Character & Integrity: The Hidden Strength Behind Wisdom", "Character & Integrity: The Hidden Strength Behind Wisdom",
  ]), {});
});

test("a show named before a bar is its series", () => {
  assert.deepEqual(label(["Fixx Ya Face Fridays | as Was Supposed!!"]), { "Fixx Ya Face Fridays | as Was Supposed!!": "Fixx Ya Face Fridays" });
});

test("a recording on one of the shows is that show, however its title writes it", async () => {
  const { showOf } = await import("../src/lib/series.ts");
  assert.equal(showOf("Patient Saints Radio | May 17, 2020"), "Patient Saints Radio");
  assert.equal(showOf("#IUIC​ |  PATIENT SAINTS RADIO | NOVEMBER 21, 2021"), "Patient Saints Radio");
  assert.equal(showOf("#IUIC l RAVENING WOLVES RADIO SHOW: Episode 45 - Nuclear War"), "Ravening Wolves Radio Show");
  assert.equal(showOf("AOG | Disclosure Day The Truth About UFOs"), "Armor of God Radio");
  assert.equal(showOf("IUIC | ARMOR OF GOD RADIO SHOW: Who Eats First The Man Or The Children"), "Armor of God Radio");
  assert.equal(showOf("HAMMERTIME | STAGNATION RUINS A NATION"), "Hammer Time");
  assert.equal(showOf("#IUIC | (RE-RUN) OUR HIDDEN HISTORY RADIO SHOW-DARK AGES: THE BEGINNING CHAPTER 1"), "Our Hidden History");
  assert.equal(showOf("#IUIC | 45 Days of Camp | Day 2 A Young Prince Makes Haste"), "45 Days of Camp");
  assert.equal(showOf("FIX YA FACE FRIDAYS: INSANITY GOING NO WHERE FAST"), "Fixx Ya Face Fridays");
  // Not shows: a Sabbath class, a subject, a sentence that only starts like one.
  assert.equal(showOf("SABBATH NOON CLASS: Which Vessel Are You?"), null);
  assert.equal(showOf("New Moon Based  Sabbath DEBUNKED!!!"), null);
  assert.equal(showOf("Edom: The Greatly Despised"), null);
  assert.equal(showOf("Tune Into “The Power Hour” ever Wednesday at 10pm est"), null);
});
