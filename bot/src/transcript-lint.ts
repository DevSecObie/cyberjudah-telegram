/**
 * Transcript linting and a readable view of the captions.
 *
 * The transcripts are YouTube auto-captions ([second, text] segments in the cyberjudah
 * repository). They read badly as they are: a turn of speakers is only ">>", older recordings
 * have no punctuation, cue tags ([Music]) and fillers sit in the words, and a book of the Bible
 * is sometimes misheard ("second edges" for 2 Esdras). This module does two things, with no model
 * and no outside service, so it is free, fast and the same every time:
 *
 * - lintTranscript: a report on how trustworthy a recording's captions are (coverage, gaps,
 *   punctuation, fillers, the known corrections from data/transcripts/corrections.json, and
 *   places where a word before "chapter N" is not a book of the 1611 Bible, which are likely
 *   mishearings for the corrections pass to learn).
 * - cleanTranscript: the captions as paragraphs, one per speaker turn, with the known
 *   corrections applied and every change listed, cue tags and fillers removed, stutters
 *   collapsed and glued numbers ("verse1") split. Wording is never otherwise changed; the
 *   verbatim captions stay available beside it.
 */

export type Segment = [number, string];
/** [segment index, second, the caption's words, the corrected words, rule] (teachings.ts). */
export type Correction = [number, number, string, string, string];
export type Paragraph = { t: number; turn: boolean; text: string };
export type Change = { t: number; was: string; now: string; rule: string };

const CUE = /\[(?:music|applause|laughter|laughs|inaudible|silence|noise|cheering|singing|__+)\]/gi;
const FILLER = /(^|[\s,])(?:um+|uh+|erm+|hmm+|uh-huh)(?=[\s,.?!]|$)[,]?/gi;
const STUTTER = /\b([A-Za-z']+)(?:\s+\1\b)+/gi;
/** Doubled words that are meant (the King James' "verily, verily", "holy, holy"), never collapsed. */
const MEANT = new Set(["verily", "holy", "amen", "that", "had", "alas", "lord", "woe", "come", "go", "read", "again", "ho", "o", "oh", "wait", "no", "yes", "very", "far", "more", "long", "so", "on"]);
const unstutter = (s: string) => s.replace(STUTTER, (all, w: string) => (MEANT.has(w.toLowerCase()) ? all : w));
const GLUED = /\b(verses?|chapters?|and)(\d)/gi;
const PUNCT = /[.?!,;:]/;

export const clock = (t: number) => {
  const x = Math.max(0, Math.floor(t));
  return `${Math.floor(x / 3600)}:${String(Math.floor((x % 3600) / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`;
};

const usable = (segments: unknown): Segment[] => (Array.isArray(segments) ? segments : [])
  .filter((s): s is Segment => Array.isArray(s) && typeof s[0] === "number" && Number.isFinite(s[0]) && typeof s[1] === "string")
  .map(([t, text]) => [t, text.replace(/\s+/g, " ").trim()] as Segment)
  .filter(([, text]) => text.length > 0);

/** The corrected words of one segment, when the corrections file still matches its caption. */
function corrected(segments: Segment[], corrections: Correction[]): Map<number, Correction> {
  const out = new Map<number, Correction>();
  for (const c of corrections) {
    if (!Array.isArray(c) || !Number.isInteger(c[0])) continue;
    const seg = segments[c[0]];
    // Only when the caption is still the one the correction was made for.
    if (seg && seg[1] === String(c[2]).replace(/\s+/g, " ").trim()) out.set(c[0], c);
  }
  return out;
}

/** One caption tidied for reading: cues and fillers out, stutters collapsed, glued numbers split. */
export function tidy(text: string, keepFillers = false): string {
  let s = text.replace(CUE, " ");
  if (!keepFillers) s = s.replace(FILLER, "$1");
  s = unstutter(s).replace(GLUED, "$1 $2");
  return s.replace(/\s+([,.?!;:])/g, "$1").replace(/\s+/g, " ").trim();
}

/**
 * The captions from `from` to `to` (seconds) as paragraphs: a new paragraph at each turn of
 * speaker (">>") and otherwise about every 90 seconds or 140 words.
 */
export function cleanTranscript(raw: unknown, corrections: Correction[], opts: { from?: number; to?: number; keepFillers?: boolean } = {}): { paragraphs: Paragraph[]; changes: Change[]; last: number | null } {
  const segments = usable(raw);
  const fixes = corrected(segments, corrections);
  const from = opts.from ?? 0, to = opts.to ?? Number.POSITIVE_INFINITY;
  const paragraphs: Paragraph[] = [];
  const changes: Change[] = [];
  let cur: Paragraph | null = null, words = 0, last: number | null = null;
  const flush = () => { if (cur && cur.text.trim()) paragraphs.push({ ...cur, text: cur.text.trim() }); cur = null; words = 0; };
  segments.forEach(([t, original], i) => {
    if (t < from || t > to) return;
    last = t;
    const fix = fixes.get(i);
    let text = original;
    if (fix) { text = String(fix[3]); changes.push({ t, was: original, now: text, rule: String(fix[4]) }); }
    // A caption can hold a turn of speaker in its middle: each ">>" starts a paragraph.
    const parts = text.split(/\s*>>\s*/);
    parts.forEach((part, k) => {
      const turn = k > 0;
      const clean = tidy(part, opts.keepFillers);
      if (turn) { flush(); cur = { t, turn: true, text: "" }; }
      if (!clean) return;
      if (cur && (t - cur.t > 90 || words > 140)) flush();
      cur ??= { t, turn, text: "" };
      cur.text += ` ${clean}`;
      words += clean.split(" ").length;
    });
  });
  flush();
  // Stutters can straddle two captions ("the" | "the people").
  for (const p of paragraphs) p.text = unstutter(p.text);
  return { paragraphs, changes, last };
}

export type LintFinding = { level: "ok" | "info" | "warn"; check: string; detail: string; examples?: string[] };
export type LintReport = { grade: "A" | "B" | "C" | "D"; words: number; minutes: number; findings: LintFinding[] };

const STOP = new Set(["the", "this", "that", "same", "next", "whole", "in", "of", "to", "and", "go", "read", "book", "entire", "previous", "last", "first", "second", "third", "his", "our", "your", "a", "an", "one", "another", "each", "every", "new", "old", "it", "its", "their", "my", "what", "which", "back", "turn", "get", "give", "me", "us", "from", "on", "at", "with", "for", "by", "then", "now", "so", "is", "was", "verse", "chapter", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "following", "said", "says", "open", "opened", "up", "out"]);

/** A spoken book name as the lint compares it: lower case, "1st"/"first"/"I" as "1", no "the book of". */
export function bookKey(s: string): string {
  return s.toLowerCase().replace(/\b(?:first|1st|i)\b/g, "1").replace(/\b(?:second|2nd|ii)\b/g, "2").replace(/\b(?:third|3rd|iii)\b/g, "3")
    .replace(/\bpsalm\b/g, "psalms").replace(/\brevelations\b/g, "revelation").replace(/\bsong of songs\b/g, "song of solomon")
    .replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

/** The lint report on one recording's captions. `books` are the 1611 Bible's book names. */
export function lintTranscript(file: { title?: string; date?: string | null; duration?: number | null; segments?: unknown }, corrections: Correction[], books: string[], extra: { teacher?: string; notes?: string } = {}): LintReport {
  const segments = usable(file.segments);
  const findings: LintFinding[] = [];
  const text = segments.map(([, s]) => s).join(" ");
  const words = text ? text.split(" ").length : 0;
  const span = segments.length ? segments[segments.length - 1][0] - segments[0][0] : 0;
  const duration = file.duration && file.duration > 0 ? file.duration : span;
  const minutes = Math.round((duration / 60) * 10) / 10;
  if (!segments.length) return { grade: "D", words: 0, minutes, findings: [{ level: "warn", check: "captions", detail: "The recording has no captions at all." }] };

  // Metadata a reader needs to cite the class.
  const missing = [!file.date ? "date" : "", !extra.teacher ? "teacher" : "", !extra.notes ? "written notes" : ""].filter(Boolean);
  findings.push(missing.length
    ? { level: missing.includes("date") || missing.includes("teacher") ? "warn" : "info", check: "metadata", detail: `Missing: ${missing.join(", ")}.` }
    : { level: "ok", check: "metadata", detail: "Date, teacher and notes are all known." });

  // Coverage: how much of the recording the captions hold.
  const covered = duration ? Math.min(1, span / duration) : 1;
  const rate = minutes ? Math.round(words / minutes) : 0;
  const gaps: string[] = [];
  for (let i = 1; i < segments.length; i++) if (segments[i][0] - segments[i - 1][0] > 45) gaps.push(`${clock(segments[i - 1][0])} to ${clock(segments[i][0])}`);
  findings.push({ level: covered < 0.85 || rate < 60 ? "warn" : "ok", check: "coverage", detail: `${words} words over ${minutes} minutes (${rate} a minute); the captions span ${Math.round(covered * 100)}% of the recording.` });
  if (gaps.length) findings.push({ level: gaps.length > 5 ? "warn" : "info", check: "gaps", detail: `${gaps.length} stretch${gaps.length === 1 ? "" : "es"} of 45 seconds or more with no captions (music, a break, or speech the captions missed).`, examples: gaps.slice(0, 6) });

  // Punctuation: older auto-captions come as one lower-case stream.
  const punctuated = segments.filter(([, s]) => PUNCT.test(s)).length / segments.length;
  findings.push(punctuated < 0.1
    ? { level: "warn", check: "punctuation", detail: `Almost no punctuation (${Math.round(punctuated * 100)}% of captions): older auto-captions. Sentences and speakers are hard to tell apart; read the clean view and check quotes against the video.` }
    : { level: "ok", check: "punctuation", detail: `${Math.round(punctuated * 100)}% of captions carry punctuation.` });

  const turns = (text.match(/>>/g) ?? []).length;
  findings.push({ level: "info", check: "speakers", detail: turns ? `${turns} turns of speaker marked (">>"). The captions never say who is speaking.` : "No turns of speaker are marked." });

  const cues = (text.match(CUE) ?? []).length, fillers = (text.match(FILLER) ?? []).length, stutters = [...text.matchAll(STUTTER)].filter((m) => !MEANT.has(m[1].toLowerCase())).length, glued = (text.match(GLUED) ?? []).length;
  const noise = [cues ? `${cues} cue tag${cues === 1 ? "" : "s"} ([Music])` : "", fillers ? `${fillers} filler${fillers === 1 ? "" : "s"} (um, uh)` : "", stutters ? `${stutters} repeated word${stutters === 1 ? "" : "s"}` : "", glued ? `${glued} glued number${glued === 1 ? "" : "s"} ("verse1")` : ""].filter(Boolean);
  if (noise.length) findings.push({ level: "info", check: "noise", detail: `${noise.join(", ")}: removed in the clean view.` });

  // The known mishearings, from the repository's corrections pass.
  const fixes = corrected(segments, corrections);
  if (fixes.size) findings.push({ level: "info", check: "known corrections", detail: `${fixes.size} misheard book or feast word${fixes.size === 1 ? "" : "s"} with a known correction (applied in the clean view, listed beside it).`, examples: [...fixes.values()].slice(0, 6).map((c) => `[${clock(c[1])}] “${c[2]}” reads “${c[3]}” (${c[4]})`) });

  // Likely mishearings nobody has a rule for yet: a word before "chapter N" that is no book.
  const names = new Set(books.map(bookKey));
  const suspects = new Map<string, string>();
  segments.forEach(([t, s], i) => {
    const pair = `${s} ${segments[i + 1]?.[1] ?? ""}`;
    for (const m of pair.matchAll(/\b((?:[A-Za-z']+\s+){0,2}[A-Za-z']+)\s+chapter\s+\d+/gi)) {
      if (m.index! > s.length) continue;
      const tokens = m[1].split(/\s+/);
      const tries = [tokens.slice(-1), tokens.slice(-2), tokens.slice(-3)].map((x) => bookKey(x.join(" ")));
      const lastWord = tokens[tokens.length - 1].toLowerCase();
      if (tries.some((k) => names.has(k)) || STOP.has(lastWord) || /^\d/.test(lastWord)) continue;
      const key = bookKey(tokens.slice(-2).join(" "));
      if (!suspects.has(key)) suspects.set(key, `[${clock(t)}] “${m[0].trim()}”`);
    }
  });
  if (suspects.size) findings.push({ level: "warn", check: "possible mishearings", detail: `${suspects.size} place${suspects.size === 1 ? "" : "s"} where the word before "chapter N" is not a book of the 1611 Bible. Check them against the video; a repeated one is a candidate rule for the corrections pass.`, examples: [...suspects.values()].slice(0, 8) });

  const warns = findings.filter((f) => f.level === "warn").length;
  const grade = warns === 0 ? "A" : warns === 1 ? "B" : warns === 2 ? "C" : "D";
  return { grade, words, minutes, findings };
}

export function formatLint(title: string, video: string, report: LintReport): string {
  const mark = { ok: "OK", info: "NOTE", warn: "CHECK" } as const;
  const lines = report.findings.map((f) => `- ${mark[f.level]} ${f.check}: ${f.detail}${f.examples?.length ? `\n${f.examples.map((e) => `    ${e}`).join("\n")}` : ""}`);
  return `Transcript lint: ${title}\nVideo: https://www.youtube.com/watch?v=${video}\nGrade ${report.grade} (A: reads cleanly; D: check every quote against the video)\n\n${lines.join("\n")}`;
}
