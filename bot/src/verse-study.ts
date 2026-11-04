/**
 * verse_study: everything the app has on a verse, read from the data site's chapter files.
 *
 * - api/concordance/<book>/<chapter>.json (cyberjudah engine/build.mjs): the study note's section
 *   on the verse (`commentary` rows of a /study note, each point with its `sources`), the precepts
 *   placed on it (`precepts`), the class notes that opened it (`moments`, `commentary`), every
 *   moment a recording read it aloud (`read`, from scripts/precepts/readings.py over all three
 *   feeds) and every note that cites it (`cited_by`).
 * - api/xref/<book>/<chapter>.json: the cross-references, `{verse: [[book slug, chapter, verse]]}`.
 *
 * Every hit says why it matched, where (a link to that second of the video), what was said there,
 * who taught it ("teacher unknown" when the data does not say) and whether the class has notes.
 * Hits are ranked by how closely they match (a reading of the verse, then a class note's passage
 * that holds it, then a precept citation, then a note's mention, then the library's other pages),
 * and within that by rank: Bishops,
 * Deacons, Captains, the rest, Zakai last. Nothing is filled in that the data does not hold.
 */

export type ReadRow = { video: string; t: number; ts: string; vt?: number; how?: string; said?: string; feed?: string; title: string; date: string; teacher: string; url?: string };
type NoteRef = { label: string; url: string; date?: string; teacher?: string };
type PreceptRow = { verses: string; kind: string; ref: { label: string; url: string }; text?: string; note: NoteRef; ts?: string; why?: string };
type MomentRow = { verses: string; label: string; url: string; date?: string; teacher?: string; video: string; t: number; ts: string };
type Source = { video: string; t: number; ts: string; title: string; date?: string; teacher?: string; url?: string; how: string } | null;
type CommentRow = { verses: string; passage?: string; points: string[]; sources?: Source[]; note: NoteRef; ts?: string; video?: string | null; t?: number };
type CitedRow = { kind: string; label: string; url: string; verses: string };
export type Concordance = { book: string; chapter: number; cited_by?: CitedRow[]; precepts?: PreceptRow[]; moments?: MomentRow[]; commentary?: CommentRow[]; read?: Record<string, ReadRow[]> };
export type Xref = Record<string, [string, number, number][]>;
export type Ask = { book: string; slug: string; chapter: number; from: number | null; to: number | null };
/** Book names by slug, for the cross-references. */
export type BookNames = Record<string, string>;

const FEED: Record<string, string> = { classes: "Sabbath class", captains: "15 Min w/ Captains", history: "Our Hidden History" };
const MAX_CLASSES = 25;
/** The kinds of page that cite a verse in their text, and how a hit names them. */
const MENTION: Record<string, string> = { note: "", precept: "Precept topic: ", encyclopedia: "Encyclopedia: ", case: "Case study: ", law: "Law handbook: " };
/** A recording's title as listed, without the channel's leading tags ("#IUIC ||", "| "). */
const tidyTitle = (t: string) => t.replace(/^\s*(?:#\w+\s*)?(?:\|+\s*)+/, "").trim() || t;

export const hms = (s: number) => {
  const x = Math.max(0, Math.floor(s)), h = Math.floor(x / 3600), m = Math.floor((x % 3600) / 60), r = x % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
};
const secondsOf = (ts: string) => ts.split(":").reduce((a, x) => a * 60 + Number(x || 0), 0);
export const videoAt = (video: string, t: number) => `https://www.youtube.com/watch?v=${video}&t=${Math.max(0, Math.floor(t))}s`;

/** Bishops 0, Deacons 1, Captains 2, everyone else and unknown 3, Zakai last. */
export function teacherRank(t: string | undefined): number {
  const s = (t ?? "").trim();
  if (/\bzakai\b/i.test(s)) return 5;
  if (/^(bishop|elder nathanyel)\b/i.test(s)) return 0;
  if (/^deacon\b/i.test(s)) return 1;
  if (/^captain\b/i.test(s)) return 2;
  return s ? 3 : 4;
}
const who = (t: string | undefined) => (t && t.trim() ? t.trim() : "teacher unknown");
const when = (d: string | undefined) => (d && d.trim() ? d.trim() : "date unknown");

/** The verses a row's `verses` covers ("14", "12-17", "2,26-27"); empty is the whole chapter. */
export function versesOf(spec: string): [number, number][] {
  return String(spec || "").split(",").map((p) => p.trim()).filter(Boolean).map((p) => {
    const [a, b] = p.split("-").map(Number);
    return [a, Number.isFinite(b) ? b : a] as [number, number];
  }).filter(([a]) => Number.isFinite(a));
}
const overlaps = (spec: string, from: number, to: number) => versesOf(spec).some(([a, b]) => a <= to && b >= from);

type Hit = { tier: number; rank: number; date: string; video: string | null; t: number; title: string; feed: string; teacher: string; notes: string | null; reason: string; snippet: string; link: string | null };

/**
 * The tool's text. `snippets` holds the caption words at a reading's verse second, fetched by the
 * caller for the hits it chose (key `${video}@${second}`); without one the words where the
 * reference was called for (`said`) stand in.
 */
export function formatVerseStudy(c: Concordance | null, xref: Xref | null, ask: Ask, names: BookNames, site: (path: string) => string, snippets: Record<string, string> = {}): string {
  const { book, chapter } = ask;
  const verseLabel = ask.from == null ? `${book} ${chapter}` : `${book} ${chapter}:${ask.from}${ask.to && ask.to > ask.from ? `-${ask.to}` : ""}`;
  const from = ask.from ?? 1, to = ask.to ?? ask.from ?? 999;
  const whole = ask.from == null;
  const out: string[] = [`${verseLabel}: what the app has. Read the verse itself with read_passage.`];

  // 1. The study note's section on the verse, each point with its source.
  const study = (c?.commentary ?? []).filter((r) => r.note?.url?.startsWith("/study/") && overlaps(r.verses, from, to));
  const studyPrecepts = (c?.precepts ?? []).filter((p) => p.kind === "precept" && p.note?.url?.startsWith("/study/") && (whole || overlaps(p.verses, from, to)));
  if (study.length || studyPrecepts.length) {
    const lines: string[] = [];
    const notes = new Map<string, string>();
    for (const r of study) notes.set(r.note.url, r.note.label);
    for (const p of studyPrecepts) notes.set(p.note.url, p.note.label);
    for (const [url, label] of notes) {
      lines.push(`${label}. Link: ${site(`${url}${whole ? "" : `#v${from}`}`)}`);
      for (const r of study.filter((x) => x.note.url === url)) {
        r.points.forEach((pt, i) => {
          const s = r.sources?.[i];
          const src = s ? `Source: ${s.title} (${when(s.date)}, ${who(s.teacher)}) at ${s.ts}, ${videoAt(s.video, s.t)}${s.url ? `, notes ${site(s.url)}` : ""}; matched by wording ${s.how === "pass" ? "in the class's precept pass" : "in the class transcript"}.` : "Source: unsourced (no class has been found that says this).";
          lines.push(`- (verse ${r.verses}) ${pt}\n  ${src}`);
        });
      }
      for (const p of studyPrecepts.filter((x) => x.note.url === url)) lines.push(`- Precept on verse ${p.verses || from}: ${p.ref.label}${p.text ? `: ${p.text}` : ""} Link: ${site(p.ref.url)}`);
    }
    out.push(`\nSTUDY NOTE\n${lines.join("\n")}`);
  }

  // 2. The classes: every reading of the verse, every class note passage that holds it, each
  // once per recording and moment, most exact first, then by rank.
  const hits: Hit[] = [];
  const seen = new Set<string>();
  const readVerses = Object.entries(c?.read ?? {}).filter(([v]) => +v >= from && +v <= to);
  const readBy = new Map<string, { row: ReadRow; verses: number[] }>();
  for (const [v, rows] of readVerses) for (const r of rows) {
    const k = `${r.video}@${r.t}`;
    const e = readBy.get(k) ?? { row: r, verses: [] };
    e.verses.push(+v);
    if (+v === from && r.vt != null) e.row = r;
    readBy.set(k, e);
  }
  for (const { row: r, verses } of readBy.values()) {
    verses.sort((a, b) => a - b);
    const at = r.vt ?? r.t;
    const one = verses.length === 1 ? `${book} ${chapter}:${verses[0]}` : `${book} ${chapter}:${verses[0]}-${verses.at(-1)}`;
    const reason = r.how === "followed"
      ? `reads ${one} at ${hms(at)}, reading on from a passage called for at ${r.ts}`
      : r.how === "verse"
        ? `reads ${one} at ${hms(at)}, called for as "verse ${verses[0]}" with ${book} ${chapter} open`
        : `calls for ${one} at ${r.ts} and reads it${r.vt != null ? ` at ${hms(r.vt)}` : ""}`;
    // The words at the verse when the transcript was read; else, for a reading that began
    // elsewhere, the words where it began, said so.
    const own = snippets[`${r.video}@${Math.floor(at)}`];
    const snippet = own ?? (r.said ? (r.how === "followed" ? `(where the reading began, ${r.ts}) ${r.said}` : r.said) : "");
    seen.add(`${r.video}`);
    hits.push({ tier: 0, rank: teacherRank(r.teacher), date: r.date || "", video: r.video, t: at, title: r.title, feed: FEED[r.feed ?? ""] ?? "", teacher: r.teacher, notes: r.url ?? null, reason, snippet, link: videoAt(r.video, at) });
  }
  // Class notes that opened a passage holding the verse, with the note's own words on it.
  const said = new Map<string, string>();
  for (const r of c?.commentary ?? []) if (!r.note?.url?.startsWith("/study/") && overlaps(r.verses, from, to) && r.points[0]) said.set(`${r.note.url}|${r.ts ?? ""}`, r.points[0]);
  for (const m of c?.moments ?? []) {
    if (!(whole || overlaps(m.verses, from, to))) continue;
    if (seen.has(m.video)) {
      // The reading is already listed: lend it the note's link and teacher.
      for (const h of hits) if (h.video === m.video) { h.notes ??= m.url; if (!h.teacher && m.teacher) { h.teacher = m.teacher; h.rank = teacherRank(m.teacher); } }
      continue;
    }
    seen.add(m.video);
    const words = said.get(`${m.url}|${m.ts}`) ?? "";
    hits.push({ tier: 2, rank: teacherRank(m.teacher), date: m.date || "", video: m.video, t: m.t, title: m.label, feed: "", teacher: m.teacher || "", notes: m.url, reason: `its notes open ${book} ${chapter}:${m.verses || "the chapter"} at ${m.ts}, a passage that holds ${verseLabel}`, snippet: words, link: videoAt(m.video, m.t) });
  }
  // A precept placed on the verse, or the verse used as a precept under another scripture.
  const videoOfNote = new Map((c?.moments ?? []).map((m) => [m.url, m.video]));
  const precepts = (c?.precepts ?? []).filter((p) => !p.note?.url?.startsWith("/study/") && (whole || overlaps(p.verses, from, to)));
  for (const p of precepts) {
    const k = `${p.note.url}|${p.ref.label}|${p.kind}`;
    if (seen.has(k)) continue; seen.add(k);
    const t = p.ts ? secondsOf(p.ts) : 0;
    const reason = p.kind === "precept"
      ? `places the precept ${p.ref.label} on ${book} ${chapter}:${p.verses}${p.ts ? ` at ${p.ts}` : ""}`
      : `cites ${book} ${chapter}:${p.verses} as a precept under ${p.ref.label}${p.ts ? ` at ${p.ts}` : ""}`;
    const video = videoOfNote.get(p.note.url) ?? null;
    hits.push({ tier: 3, rank: teacherRank(p.note.teacher), date: p.note.date || "", video, t, title: p.note.label, feed: "", teacher: p.note.teacher || "", notes: p.note.url, reason, snippet: p.text ?? "", link: video && p.ts ? videoAt(video, t) : null });
  }
  // Notes that cite the verse in their text, with no moment of their own.
  const listed = new Set(hits.map((h) => h.notes).filter(Boolean));
  const cites = new Map<string, CitedRow>();
  for (const r of c?.cited_by ?? []) {
    if (!(r.kind in MENTION) || listed.has(r.url) || r.url.startsWith("/study/") && study.some((s) => s.note.url === r.url)) continue;
    if (!r.verses ? !whole : !overlaps(r.verses, from, to)) continue;
    cites.set(r.url, r);
  }
  for (const r of cites.values()) hits.push({ tier: r.kind === "note" ? 4 : 5, rank: 3, date: "", video: null, t: 0, title: `${MENTION[r.kind]}${r.label}`, feed: "", teacher: "", notes: r.url, reason: r.verses ? `cites ${book} ${chapter}:${r.verses} in its text (no moment recorded)` : `cites ${book} ${chapter} in its text`, snippet: "", link: null });

  hits.sort((a, b) => a.tier - b.tier || a.rank - b.rank || b.date.localeCompare(a.date) || a.title.localeCompare(b.title));
  if (hits.length) {
    const shown = hits.slice(0, MAX_CLASSES).map((h, i) => {
      const head = `${i + 1}. ${tidyTitle(h.title)}${h.feed ? ` (${h.feed})` : ""}, ${when(h.date)}, ${who(h.teacher)}`;
      const notes = h.notes ? `Notes: ${site(h.notes)}` : "Notes: none yet";
      return [head, `   Match: ${h.reason}.`, h.snippet ? `   Said: “${h.snippet.replace(/\s+/g, " ").trim()}”` : null, h.link ? `   Video: ${h.link}` : null, `   ${notes}`].filter(Boolean).join("\n");
    });
    out.push(`\nCLASSES (${hits.length > MAX_CLASSES ? `the first ${MAX_CLASSES} of ${hits.length}` : `${hits.length}`}; readings of the verse first, then Bishops, Deacons, Captains)\n${shown.join("\n")}`);
  } else out.push(`\nCLASSES\nNo class or note has been found reading ${verseLabel} yet.`);

  // 3. Cross-references.
  const xr: string[] = [];
  for (let v = from; v <= Math.min(to, from + 5); v++) for (const [slug, ch, vv] of xref?.[String(v)] ?? []) xr.push(`${names[slug] ?? slug} ${ch}:${vv}`);
  if (!whole) out.push(`\nCROSS-REFERENCES\n${xr.length ? [...new Set(xr)].join("; ") : "None listed."}`);
  return out.join("\n");
}

/** The readings whose snippets are worth fetching from the transcript: the first few shown. */
export function snippetWanted(c: Concordance | null, from: number, to: number, max = 16): { video: string; t: number }[] {
  const out: { video: string; t: number }[] = [];
  const seen = new Set<string>();
  const rows = Object.entries(c?.read ?? {}).filter(([v]) => +v >= from && +v <= to).flatMap(([, r]) => r);
  rows.sort((a, b) => teacherRank(a.teacher) - teacherRank(b.teacher) || (b.date || "").localeCompare(a.date || ""));
  for (const r of rows) {
    const t = Math.floor(r.vt ?? r.t), k = `${r.video}@${t}`;
    if (seen.has(k)) continue; seen.add(k);
    out.push({ video: r.video, t });
    if (out.length >= max) break;
  }
  return out;
}

/** The caption words from a second on, about a line's worth. */
export function captionAt(segments: [number, string][], t: number, words = 24): string {
  const i = segments.findIndex(([s]) => s >= t - 0.5);
  if (i < 0) return "";
  const text = segments.slice(i, i + 12).map(([, s]) => s).join(" ").replace(/>>/g, " ").replace(/\s+/g, " ").trim();
  return text.split(" ").slice(0, words).join(" ");
}
