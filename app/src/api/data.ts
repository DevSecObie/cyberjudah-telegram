/**
 * The CyberJudah data set, read straight from the data origin (engine/README.md in the
 * cyberjudah repo is the contract). Types cover the fields the app shows.
 */
export const DATA_ORIGIN: string = (import.meta.env.VITE_DATA_ORIGIN as string | undefined) || "https://data.cyberjudah.io";
export const SITE_URL = "https://cyberjudah.io";

import { cachedResponse } from "@/lib/offline";

/** Network first; a saved (offline) copy when the network fails. */
async function get<T>(path: string): Promise<T> {
  const url = `${DATA_ORIGIN}${path}`;
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`${res.status} ${path}`);
    return (await res.json()) as T;
  } catch (e) {
    const cached = await cachedResponse(url);
    if (cached) return (await cached.json()) as T;
    throw e;
  }
}

export type Book = { book: string; slug: string; chapters: number; verses: number; testament: "Old Testament" | "New Testament" | "Apocrypha"; url: string; chapterIds: number[] };
export type Verse = { verse: number; text: string };
export type Chapter = { book: string; chapter: number; translation: string; url: string; verses: Verse[] };
export type Citation = { kind: string; label: string; url: string; verses?: string };
/** A precept lined up with a scripture in class: `precept` = taught under this chapter's verses, `opened` = this chapter's verses were the precept under `ref`. */
export type TaughtPrecept = { verses: string; kind: "precept" | "opened"; ref: { book: string; chapter: number; verses: string; label: string; url: string }; text: string; point: string; note: { label: string; url: string; date: string; teacher: string }; ts: string };
export type Concordance = { book: string; chapter: number; cited_by: Citation[]; precepts?: TaughtPrecept[] };
export type NoteRow = { kind: "study" | "class" | "captains" | "history" | "encyclopedia"; title: string; url: string; book?: string | null; chapters?: [number, number] | null; range?: string; date?: string | null; year?: string; series?: string; teacher?: string; topics?: string[]; summary?: string; videoId?: string | null };
export type Note = NoteRow & { body: string; file?: string | null };
export type FeedRow = { title: string; url: string; date: string; year: string; teacher: string; collection?: string; thumb: string; books: string[]; topics?: string[] };
export type HistoryRow = { slug: string; title: string; url: string; episode: number | null; date: string | null; year: string; duration: number | null; videoId: string; thumb: string; teacher: string; topics: string[]; summary: string; noted?: boolean };
export type HistoryEpisode = HistoryRow & { start: number; body: string | null; turns: { t: number; text: string }[] };
export type Stats = { chapters: number; books: number; verses: number; studies: number; classes: number; captains: number; laws: number; precepts: number; cases: number; recent: { kind: string; title: string; url: string; date: string; teacher: string; thumb: string; books: string[] }[] };
export type ResolvedRef = { book: string; chapter: number; verses?: string; key?: boolean; slug: string | null; url: string | null; label: string; study: { range: string; url: string } | null; text: Verse[]; more: number };
export type LawPart = { n: number; title: string; url: string; sections: { id: string; title: string; laws: number; url: string }[] };
export type LawSection = { id: string; title: string; part: { n: number; title: string; url: string }; url: string; seeAlso: { id: string; title: string; url: string | null }[]; entries: { id: string; text: string; refs: ResolvedRef[]; citation: string }[]; caseRefs?: { slug: string; name: string; charge: string; verdict: string; url: string }[] };
export type PreceptRow = { slug: string; title: string; refs: number; url: string };
export type Precept = { slug: string; title: string; url: string; refs: ResolvedRef[] };
export type CaseRow = { slug: string; name: string; era: string; kind: "judgment" | "blessing"; charge: string; verdict: string; url: string; code?: string; themes?: string[]; topics?: string[] };
export type CaseIndex = { eras: string[]; verdicts: Record<string, string>; cases: CaseRow[] };
export type Case = CaseRow & { summary: string; offense: string; judgment: string; verdictLabel?: string; refsResolved?: ResolvedRef[]; lawsResolved?: { id: string; text: string; url: string | null }[]; preceptsResolved?: { slug: string; title: string; url: string | null }[]; relatedCases?: { slug: string; name: string; desc: string }[]; taught?: { title: string; range: string; url: string }[]; see?: { title: string; url: string }[] };
export type TopicRow = { slug: string; label: string; notes: number; cases: number; url: string };
export type Topic = { slug: string; label: string; url: string; items: { kind: "class" | "captains" | "case"; title: string; url: string; date?: string | null; teacher?: string; charge?: string; verdict?: string }[] };
export type EncyclopediaRow = { slug: string; title: string; url: string; summary: string };
export type Xref = Record<string, [string, number, number][]>;

const abs = <T extends { thumb: string }>(rows: T[]) => rows.map((r) => (r.thumb?.startsWith("/") ? { ...r, thumb: `${DATA_ORIGIN}${r.thumb}` } : r));

export const data = {
  books: () => get<Book[]>("/api/kjv/books.json"),
  chapter: (slug: string, ch: number) => get<Chapter>(`/api/kjv/${slug}/${ch}.json`),
  xref: (slug: string, ch: number) => get<Xref>(`/api/xref/${slug}/${ch}.json`),
  concordance: (slug: string, ch: number) => get<Concordance>(`/api/concordance/${slug}/${ch}.json`),
  notes: () => get<NoteRow[]>("/api/notes/index.json"),
  note: (sitePath: string) => get<Note>(`/api/notes${sitePath}.json`),
  classes: () => get<FeedRow[]>("/search/classes.json").then(abs),
  captains: () => get<FeedRow[]>("/search/captains.json").then(abs),
  history: () => get<HistoryRow[]>("/api/history/index.json").then(abs),
  episode: (slug: string) => get<HistoryEpisode>(`/api/history/${slug}.json`),
  stats: () => get<Stats>("/api/stats.json").then((s) => ({ ...s, recent: abs(s.recent) })),
  laws: () => get<LawPart[]>("/api/laws/index.json"),
  law: (id: string) => get<LawSection>(`/api/laws/${id.toUpperCase()}.json`),
  precepts: () => get<PreceptRow[]>("/api/precepts/index.json"),
  precept: (slug: string) => get<Precept>(`/api/precepts/${slug}.json`),
  cases: () => get<CaseIndex>("/api/cases/index.json"),
  case: (slug: string) => get<Case>(`/api/cases/${slug}.json`),
  topics: () => get<TopicRow[]>("/api/topics/index.json"),
  topic: (slug: string) => get<Topic>(`/api/topics/${slug}.json`),
  topicLabels: () => get<{ slug: string; label: string }[]>("/search/topics.json"),
  encyclopedia: () => get<EncyclopediaRow[]>("/api/encyclopedia/index.json"),
};

export function fmtDate(d?: string | null): string {
  if (!d) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  if (!m) return d;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}
export const when = (date?: string | null, teacher?: string) => [fmtDate(date), teacher ?? ""].filter(Boolean).join(" · ");

/** "16", "16-18", "3,5-7" -> numbers. */
export function verseNumbers(spec?: string | null): number[] {
  if (!spec) return [];
  const out: number[] = [];
  for (const part of spec.split(/[,;]\s*/)) {
    const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part.trim());
    if (!m) continue;
    const a = +m[1], b = m[2] ? +m[2] : a;
    for (let v = a; v <= b && v - a < 200; v++) out.push(v);
  }
  return [...new Set(out)].sort((a, b) => a - b);
}
/** numbers -> "16-18,20". */
export function compressVerses(nums: number[]): string {
  const s = [...new Set(nums)].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < s.length; i++) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    out.push(j > i ? `${s[i]}-${s[j]}` : String(s[i]));
    i = j;
  }
  return out.join(",");
}
/** The concordance calls every note "note"; the URL tells which shelf it is on. */
export function shelf(url: string, kind?: string): string {
  if (kind === "law" || kind === "precept" || kind === "case") return kind;
  const top = url.split("/")[1];
  return ({ study: "Study", classes: "Class", captains: "Captains", history: "History", encyclopedia: "Encyclopedia", law: "Law", precepts: "Precept", cases: "Case" } as Record<string, string>)[top] ?? "Note";
}
