/**
 * The series a class belongs to, read from its own title, so a class taught as one of a run is
 * labelled by that run rather than as a plain Sabbath class:
 *
 * - "Leaven: The Root of Bitterness Part 2" is part 2 of "Leaven: The Root of Bitterness", and the
 *   class titled exactly that is its part 1;
 * - "Navigating Through Paul's Letters: Walking Through Galatians" belongs to "Navigating Through
 *   Paul's Letters" when another class carries the same heading (a heading of one word, such as
 *   "Edom:", names the subject, not a series);
 * - "Fixx Ya Face Fridays | As Was Supposed" belongs to "Fixx Ya Face Fridays": a heading before
 *   " | " that names a recurring show, or that more than one class carries.
 *
 * Nothing is labelled a series unless its title says so.
 */
export type Series = { name: string; part?: number };

const PART = /[\s,:-]*[([]?\b(?:part|pt)\.?\s*(\d+)[)\]]?[\s!.]*$/i;
const SHOW = /\b(?:mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?|series|show|talk|podcast)\b/i;
const key = (s: string) => s.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const words = (s: string) => key(s).split(" ").filter(Boolean).length;
const SMALL = new Set(["a", "an", "and", "the", "of", "in", "into", "to", "for", "on", "our", "s"]);
const sig = (s: string) => new Set(key(s).split(" ").map((w) => w.replace(/s$/, "")).filter((w) => w && !SMALL.has(w)));
/** Every significant word of a is in b. */
const within = (a: string, b: string) => { const B = sig(b); return [...sig(a)].every((w) => B.has(w)); };
const same = (a: string, b: string) => within(a, b) && within(b, a);
/** The title without a leading channel tag such as "#IUIC |". */
const bare = (t: string) => t.replace(/^\s*#\w+\s*\|\s*/, "").replace(/\s*\|\s*$/, "").trim();

function heading(title: string): { head: string; bar: boolean } | null {
  const t = bare(title);
  const bar = t.indexOf(" | "), colon = t.indexOf(": ");
  const at = [bar, colon].filter((i) => i > 0).sort((a, b) => a - b)[0];
  if (at === undefined) return null;
  return { head: t.slice(0, at).trim(), bar: at === bar };
}

/** Each title's series, by title; titles in no series are left out. */
export function seriesOf(titles: string[]): Map<string, Series> {
  const out = new Map<string, Series>();
  const uniq = [...new Set(titles)];

  // A run of numbered parts, and the unnumbered class it continues. Parts worded a little
  // differently ("into" for "to", a longer subtitle) are one run when one's words hold the other's.
  const parts: { t: string; stem: string; n: number }[] = [];
  for (const t of uniq) {
    const m = PART.exec(bare(t));
    if (!m || +m[1] < 2) continue;
    const stem = bare(t).slice(0, m.index).replace(/[\s,:;-]+$/, "");
    if (stem) parts.push({ t, stem, n: +m[1] });
  }
  const runs: string[] = [];
  for (const p of [...parts].sort((a, b) => a.stem.length - b.stem.length)) {
    const run = runs.find((r) => within(r, p.stem)) ?? (runs.push(p.stem), p.stem);
    out.set(p.t, { name: run, part: p.n });
  }
  for (const t of uniq) {
    if (out.has(t)) continue;
    const run = runs.find((r) => same(r, bare(t)));
    if (run) out.set(t, { name: run, part: 1 });
  }

  // A shared heading. "The Vantage Point of the Elders" and "… of the Elders & Fathers" are one run.
  const heads = uniq.map((t) => ({ t, h: heading(t) })).filter((x): x is { t: string; h: { head: string; bar: boolean } } => !!x.h);
  const byKey = new Map<string, Set<string>>();
  for (const { t, h } of heads) { const k = key(h.head); byKey.set(k, (byKey.get(k) ?? new Set()).add(t)); }
  const shared = [...byKey.keys()].sort((a, b) => a.length - b.length);
  const rootOf = (k: string) => shared.find((r) => (r === k || k.startsWith(`${r} `)) && words(r) >= 2 && new Set([...byKey.entries()].filter(([o]) => o === r || o.startsWith(`${r} `)).flatMap(([, s]) => [...s])).size >= 2);
  for (const { t, h } of heads) {
    if (out.has(t)) continue;
    const r = rootOf(key(h.head));
    if (r) { out.set(t, { name: heads.find((x) => key(x.h.head) === r)!.h.head }); continue; }
    if (h.bar && SHOW.test(h.head)) out.set(t, { name: h.head });
  }
  return out;
}

/** "Navigating Through Paul's Letters", or "Leaven: The Root of Bitterness · Part 2". */
export const seriesLabel = (s: Series) => (s.part ? `${s.name} · Part ${s.part}` : s.name);

/**
 * The assembly's named shows and programmes, as their titles write them ("#IUIC | PATIENT SAINTS
 * RADIO: July 31 2022", "AOG | Disclosure Day", "HammerTime: …"). A recording of one is shown as
 * that show, not as a Sabbath class. Each name and spelling is taken from the recordings' titles.
 */
const SHOWS: [RegExp, string][] = [
  [/^patient saints radio\b/, "Patient Saints Radio"],
  [/^raven(?:ing)? wolves\b/, "Ravening Wolves Radio Show"],
  [/^(?:armou?r of god|aog)\b/, "Armor of God Radio"],
  [/^wisdom crieth out\b/, "Wisdom Crieth Out"],
  [/^lionz den\b/, "Lionz Den Radio Show"],
  [/^battle beyond\b/, "Battle Beyond Radio Show"],
  [/^(?:our hidden history|ohh)\b/, "Our Hidden History"],
  [/^times of the gentiles\b/, "Our Hidden History"],
  [/^fixx? ya face\b/, "Fixx Ya Face Fridays"],
  [/^hammer ?time\b/, "Hammer Time"],
  [/^(?:the )?power hour plus\b/, "The Power Hour Plus"],
  [/^(?:the )?power hour\b/, "The Power Hour"],
  [/^tuesday night redemption\b/, "Tuesday Night Redemption"],
  [/^friday night raw\b/, "Friday Night Raw"],
  [/^man up mondays\b/, "Man Up Mondays"],
  [/^(?:escaping the plantation|escp) ?2\.0\b/, "Escaping the Plantation 2.0"],
  [/^(?:escaping the plantation|escp)\b/, "Escaping the Plantation"],
  [/^precept ?upon ?precept\b/, "Precept Upon Precept"],
  [/^let.?s talk truth\b/, "Let's Talk Truth"],
  [/^truth be told\b/, "Truth Be Told"],
  [/^secrets of history\b/, "Secrets of History"],
  [/^(\d+) days of camp\b/, "$1 Days of Camp"],
  [/^new moon(?: sabbath)?(?: class)?\s*[:|]/, "New Moon class"],
  [/^(?:the bible\s*:?\s*)?(?:the )?book of our fathers\b/, "The Bible: Book of Our Fathers"],
  [/^the israelites\s*[:|-]/, "The Israelites"],
  [/^barbershop talk\b/, "Barbershop Talk"],
  [/^battle axe radio\b/, "Battle Axe Radio"],
  [/^(?:the )?natives hour\b/, "The Natives Hour"],
  [/^(?:the )?nehemiah squad radio\b/, "The Nehemiah Squad Radio"],
  [/^(?:the )?writings on the wall radio\b/, "The Writings on the Wall Radio"],
  [/^(?:the )?revolutionaries of gad\b/, "The Revolutionaries of Gad"],
  [/^fcn\b/, "FCN"],
  [/^itsr\b/, "ITSR"],
];
/** The title as said, without the channel's leading tags ("#IUIC |", "IUIC l", "#IUICNEWORLEANS PRESENTS:"). */
const spoken = (t: string) => t.replace(/[\u200b\u00a0]/g, " ").replace(/^(?:\s*#?\s*iuic\w*(?:\s+presents)?\s*(?:\||\bl\b|:)?\s*)+/i, "").replace(/^\(?re-?run\)?\s*/i, "").replace(/[’]/g, "'").trim().toLowerCase();

/** The show a recording belongs to, read from its title, or null. */
export function showOf(title: string): string | null {
  const t = spoken(title ?? "");
  for (const [re, name] of SHOWS) { const m = re.exec(t); if (m) return name.replace("$1", m[1] ?? ""); }
  return null;
}
