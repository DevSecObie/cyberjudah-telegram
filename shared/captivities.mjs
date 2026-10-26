/**
 * The Timeline ordered by the captivities (Obie, 2026-10-26: "the timeline should be ordered by
 * captives, with the main prophets or biblical figures of that time period"). The captivities,
 * their years and their people are from the assembly's booklet Obie sent, "Captivity packets"
 * (written and compiled by Nathanyel Ben Israel, Israel United in Christ; "all dates are at best
 * approximates"): Assyria p. 2, Babylon p. 9, Persia p. 14, Greece p. 20, Rome p. 32, America p. 45.
 * The American Captivity starts in 1492, when the booklet dates the conquest of the northern
 * kingdom ("whatever history states", Obie).
 *
 * This only regroups the periods already on the timeline (app/src/data/timeline.json, which the
 * builders keep writing as before): a period that runs across captivities is cut at their years
 * into one period each, keeping its events' rows, and every period is put under its captivity as
 * its age. No event is left out; one that runs across a cut shows on both sides, as Bible Strong
 * repeats an event across periods. Done where the data is read, so the Final Captivity and
 * Between the Testaments builders, which splice their periods in by Bible Strong's ids, are untouched.
 */

/** Each captivity, in order, with the people the booklet names in it. */
export const CAPTIVITIES = [
  { id: "assyrian", age: "The Assyrian Captivity", years: "722–605 BC", from: -722, to: -605, color: "#2f9fa8", page: 2,
    prophets: ["Isaiah", "Hosea", "Jonah", "Nahum", "Zephaniah", "Tobit"], figures: ["Hezekiah", "Sennacherib"] },
  { id: "babylonian", age: "The Babylonian Captivity", years: "605–539 BC", from: -605, to: -539, color: "#33bdbb", page: 9,
    prophets: ["Daniel", "Jeremiah", "Ezekiel", "Habakkuk"], figures: ["Jehoiakim", "Jehoiachin", "Zedekiah", "Nebuchadnezzar", "Belshazzar"] },
  { id: "persian", age: "The Persian and Mede Captivity", years: "539–331 BC", from: -539, to: -331, color: "#3aa98a", page: 14,
    prophets: ["Haggai", "Zechariah", "Malachi"], figures: ["Zerubbabel", "Ezra", "Nehemiah", "Esther", "Cyrus"] },
  { id: "greek", age: "The Greek Captivity", years: "333–134 BC", from: -333, to: -64, color: "#45a45f", page: 20,
    prophets: [], figures: ["Alexander the Great", "Jesus ben Sirach", "Antiochus Epiphanes", "Mattathias", "Judas Maccabeus", "Jonathan", "Simon", "John Hyrcanus"],
    note: "From Simon's death to Pompey taking Jerusalem in 64 BC, the Hasmoneans, the booklet's Greek list runs on to Rome." },
  { id: "roman", age: "The Roman Captivity", years: "64 BC–AD 193", from: -64, to: 193, color: "#52b148", page: 32,
    prophets: ["John the Baptist"], figures: ["Christ", "Peter", "Paul", "Stephen", "Herod the Great", "Pontius Pilate", "Agrippa"] },
  { id: "dark-ages", age: "The Dark Ages", years: "AD 193–1492", from: 193, to: 1492, color: "#c9a826", page: 44, prophets: [], figures: [],
    note: "Rome overthrown in 193, \"followed by the Dark ages\" (the booklet, p. 44)." },
  { id: "american", age: "The American Captivity", years: "1492–today", from: 1492, to: Infinity, color: "#c7552f", page: 45, prophets: [], figures: [],
    note: "\"1492 began the conquest of the Northern kingdom of Israel.\" \"1611 began the conquest of the Southern kingdom of Judah.\" The United States, \"Babylon the Great\", 1776 to today." },
];

/**
 * Where each period of the data goes, by its id: under one captivity, or cut into several, each
 * piece with its own canvas years (Bible Strong's are round numbers a little either side of the
 * years in its title). Bible Strong's periods before the captivities (Creation to the Divided
 * Kingdom) keep their own ages. Into the Ships begins with Portugal's first raids (1441), before
 * 1492; it stays whole, as the first period of the American Captivity.
 */
export const PLACES = {
  8: { cut: [
    { under: "assyrian", title: "Assyria", subTitle: "c.722–605 BC", startYear: -725, endYear: -605, interval: 5 },
    { under: "babylonian", title: "Babylon", subTitle: "c.605–539 BC", startYear: -605, endYear: -539, interval: 5 },
    { under: "persian", title: "Persia", subTitle: "c.539–331 BC", startYear: -540, endYear: -330, interval: 10 },
    { under: "greek", title: "Greece", subTitle: "c.333–64 BC", startYear: -335, endYear: -60, interval: 10 },
  ] },
  9: { under: "roman" },
  10: { cut: [
    { under: "roman", subTitle: "c.34–193 AD", startYear: 35, endYear: 195, interval: 5 },
    { under: "dark-ages", subTitle: "c.193–330 AD", startYear: 190, endYear: 350, interval: 5 },
  ] },
  11: { under: "dark-ages" },
  12: { under: "american" },
};
const FINAL = /^fc-/;
const BETWEEN = /^btt-/;

const byId = new Map(CAPTIVITIES.map((c) => [c.id, c]));
/** The captivity of a period, if it is in one. */
export const captivityOf = (s) => (s.captivity ? byId.get(s.captivity) : undefined);

/**
 * The periods ordered by the captivities. A period of a captivity has it as its age and carries
 * `captivity` (its id); a piece of a cut period carries `from`, the id of the period it was cut
 * from. A piece has the events whose years touch its canvas, on their rows, and no picture of its
 * own until one is uploaded (its colour shows, as for any period waiting on its picture).
 */
export function byCaptivity(sections) {
  const out = [];
  for (const s of sections) {
    const place = PLACES[s.id] ?? (FINAL.test(s.id) ? { under: "american" } : BETWEEN.test(s.id) ? { under: "persian" } : null);
    if (!place) { out.push(s); continue; }
    if (place.under) { const c = byId.get(place.under); out.push({ ...s, sectionTitle: c.age, captivity: c.id }); continue; }
    for (const p of place.cut) {
      const c = byId.get(p.under);
      out.push({
        ...s, id: `${s.id}-${c.id}`, from: s.id, title: p.title ?? s.title, sectionTitle: c.age, captivity: c.id, subTitle: p.subTitle,
        startYear: p.startYear, endYear: p.endYear, interval: p.interval, color: p.title ? c.color : s.color,
        events: s.events.filter((e) => e.start <= p.endYear && e.end >= p.startYear),
      });
    }
  }
  // The periods before the captivities first, as they were; then each captivity's, by their years.
  const rank = new Map(CAPTIVITIES.map((c, i) => [c.id, i]));
  return out.map((s, i) => ({ s, i, r: s.captivity ? rank.get(s.captivity) : -1 }))
    .sort((a, b) => a.r - b.r || (a.r >= 0 ? a.s.startYear - b.s.startYear : 0) || a.i - b.i)
    .map(({ s }) => s);
}
