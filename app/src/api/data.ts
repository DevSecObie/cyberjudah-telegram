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
/** A verse, and (for the 66 books) its words in spans, each span ending in a word Strong keyed to its Hebrew or Greek. */
export type Verse = { verse: number; text: string; words?: [string, string[]][] };
/** A Strong's number: the Hebrew or Greek word, its meaning, how the King James renders it, and every verse it stands behind. */
export type StrongsEntry = { number: string; language: "Hebrew" | "Greek"; lemma: string; xlit: string; pron: string; derivation: string; def: string; kjv: string; count: number; verses: number; words: { word: string; count: number }[]; occurrences: { slug: string; book: string; chapter: number; verse: number; text: string; words: string[] }[]; source: string };
export type StrongsRow = { n: string; lemma: string; xlit: string; def: string; count: number };

/**
 * The Apocrypha in the order and under the names of the 1611 King James Bible: 1 and 2 Esdras,
 * Tobit, Judith, the Rest of Esther, the Wisdom of Solomon, Ecclesiasticus, Baruch with the
 * Epistle of Jeremiah, the Song of the Three Holy Children, Susanna, Bel and the Dragon, the
 * Prayer of Manasses, 1 and 2 Maccabees. Slugs and links stay as the data set has them.
 */
export const APOCRYPHA: [slug: string, name: string][] = [
  ["1-esdras", "1 Esdras"], ["2-esdras", "2 Esdras"], ["tobit", "Tobit"], ["judith", "Judith"],
  ["esther-greek", "Rest of Esther"], ["wisdom-of-solomon", "Wisdom of Solomon"], ["sirach", "Ecclesiasticus"],
  ["baruch", "Baruch"], ["epistle-of-jeremiah", "Epistle of Jeremiah"], ["song-of-the-three-children", "Song of the Three Holy Children"],
  ["susanna", "History of Susanna"], ["bel-and-the-dragon", "Bel and the Dragon"], ["prayer-of-manasseh", "Prayer of Manasses"],
  ["1-maccabees", "1 Maccabees"], ["2-maccabees", "2 Maccabees"],
];
export function orderApocrypha(books: Book[]): Book[] {
  const rest = books.filter((b) => b.testament !== "Apocrypha");
  const by = new Map(books.map((b) => [b.slug, b]));
  const apoc = APOCRYPHA.flatMap(([slug, name]) => { const b = by.get(slug); return b ? [{ ...b, book: name }] : []; });
  const known = new Set(APOCRYPHA.map(([s]) => s));
  return [...rest, ...apoc, ...books.filter((b) => b.testament === "Apocrypha" && !known.has(b.slug))];
}
export type Chapter = { book: string; chapter: number; translation: string; url: string; verses: Verse[]; /** The 1611's prologue(s) before chapter 1 (Ecclesiasticus), not verses. */ prologue?: { title: string; text: string }[] };
export type Citation = { kind: string; label: string; url: string; verses?: string };
/** A precept lined up with a scripture in class: `precept` = taught under this chapter's verses, `opened` = this chapter's verses were the precept under `ref`. */
export type TaughtPrecept = { verses: string; kind: "precept" | "opened"; ref: { book: string; chapter: number; verses: string; label: string; url: string }; text: string; point: string; /** A short breakdown of why this precept goes with the verse, written from the class. */ why?: string; note: { label: string; url: string; date: string; teacher: string }; ts: string };
/** A short note the classes made on a verse itself (what was said about it), with where it was said. */
export type VerseNote = { verses: string; text: string; note: { label: string; url: string; date: string; teacher: string }; ts: string };
/** A moment a class read a scripture: the verses, the class, and its recording at that second. */
export type ClassMoment = { verses: string; label: string; url: string; date: string; video: string; t: number; ts: string; teacher?: string };
/** A class's own breakdown of a verse it opened: its points on that verse, and the moment it was read. */
export type VerseComment = { verses: string; passage: string; points: string[]; note: { label: string; url: string; date: string; teacher: string }; ts: string; video: string | null; t: number };
/** A person named in the Bible (STEPBible TIPNR, CC BY 4.0), with what the classes taught where they come up. */
export type PersonRef = { id: string; name: string };
export type Person = { id: string; name: string; names: string[]; description: string; type: string; tribe: string; father: PersonRef[]; mother: PersonRef[]; siblings: PersonRef[]; partners: PersonRef[]; children: PersonRef[]; verses: string[]; taught: { verse: string; url: string; points: string[]; note: { label: string; url: string; date: string; teacher: string }; ts: string; video: string | null; t: number }[]; source: { name: string; license: string; url: string }; cases?: PersonCase[] };
/** A case study that names a person: its title says who, and they are named in its scripture. */
export type PersonCase = { slug: string; name: string; url: string; era: string; kind: "judgment" | "blessing"; verdict: string; verdictLabel: string; charge: string; preview: string };
export type PersonIndexRow = { id: string; name: string; names: string[]; description: string; verses: number; first: string; type?: string };
/** A moment a class read this verse aloud, found in its transcript: the recording at that second, and the note if the class has one. */
export type Reading = { video: string; t: number; ts: string; title: string; date: string; teacher: string; url?: string };
export type Concordance = { book: string; chapter: number; cited_by: Citation[]; precepts?: TaughtPrecept[]; notes?: VerseNote[]; moments?: ClassMoment[]; commentary?: VerseComment[]; people?: Record<string, string[]>; read?: Record<string, Reading[]> };
export type NoteRow = { kind: "study" | "class" | "captains" | "history" | "encyclopedia"; title: string; url: string; book?: string | null; chapters?: [number, number] | null; range?: string; date?: string | null; year?: string; series?: string; teacher?: string; topics?: string[]; summary?: string; videoId?: string | null };
export type Note = NoteRow & { body: string; file?: string | null; books?: BookRead[] };
/** A public-domain book the classes read from (data/library), and the moments they read it. */
export type BookRead = { slug: string; title: string; vol: number; page: number; t: number; ts: string; video?: string };
export type LibraryRow = { slug: string; title: string; subtitle: string; author: string; year: number; pages: number; volumes: number; chapters: number; figures: number; cover: string | null; reads: number; classes: number };
/** A line of what the class said, from the recording's captions, at that second. */
export type SaidLine = { t: number; text: string };
export type ClassReading = { video: string; vol: number; page: number; t: number; ts: string; title: string; date: string | null; teacher: string; url: string | null; said?: SaidLine[] };
export type BookChapterRow = { k: number; n: string; title: string; vol: number; volume: string; page: number; end: number; topics: string; reads: number };
export type BookFigure = { kind: "foldout" | "plate" | "figure"; title: string; caption: string; vol: number; page: number | null; img: number; file: string; url: string; width: number; height: number; chapter: number; reads: number; readings: Omit<ClassReading, "page" | "vol">[] };
export type LibraryBook = LibraryRow & { publisher: string; license: string; source: string; items: { id: string; label: string }[]; scan: string; chapters: BookChapterRow[]; figures: BookFigure[]; reads: ClassReading[] };
export type BookPage = { vol: number; page: number; img: number; words: number; text: string; reads: Omit<ClassReading, "page" | "vol">[]; figure: string | null; foldout: BookFigure | null };
export type LibraryChapter = BookChapterRow & { item: string | null; pages: BookPage[] };
/** A chapter a class opened, in the class's order. */
export type Opened = { label: string; slug: string; chapter: number };
export type FeedRow = { title: string; url: string; date: string; year: string; teacher: string; collection?: string; thumb: string; books: string[]; topics?: string[]; videoId?: string | null; /** The note's opening, plain text, cut near 600 characters. */ intro?: string; opens?: Opened[] };
export type HistoryRow = { slug: string; title: string; url: string; episode: number | null; date: string | null; year: string; duration: number | null; videoId: string; thumb: string; teacher: string; topics: string[]; summary: string; noted?: boolean; intro?: string };
export type HistoryEpisode = HistoryRow & { start: number; body: string | null; turns: { t: number; text: string }[] };
export type WhatsNew = { kind: "pass" | "book" | "class" | "captains"; title: string; url: string; date: string; teacher: string; sub: string };
export type Stats = { chapters: number; books: number; verses: number; studies: number; classes: number; captains: number; laws: number; precepts: number; cases: number; recent: { kind: string; title: string; url: string; date: string; teacher: string; thumb: string; books: string[] }[]; whatsNew?: WhatsNew[] };
export type ResolvedRef = { book: string; chapter: number; verses?: string; key?: boolean; slug: string | null; url: string | null; label: string; study: { range: string; url: string } | null; text: Verse[]; more: number };
export type LawPart = { n: number; title: string; url: string; sections: { id: string; title: string; laws: number; url: string }[] };
export type LawSection = { id: string; title: string; part: { n: number; title: string; url: string }; url: string; seeAlso: { id: string; title: string; url: string | null }[]; entries: { id: string; text: string; refs: ResolvedRef[]; citation: string }[]; caseRefs?: { slug: string; name: string; charge: string; verdict: string; url: string }[] };
export type PreceptRow = { slug: string; title: string; refs: number; url: string };
export type Precept = { slug: string; title: string; url: string; refs: ResolvedRef[] };
export type CaseRow = { slug: string; name: string; era: string; kind: "judgment" | "blessing"; charge: string; verdict: string; url: string; code?: string; themes?: string[]; topics?: string[] };
export type CaseIndex = { eras: string[]; verdicts: Record<string, string>; cases: CaseRow[] };
export type Case = CaseRow & { summary: string; offense: string; judgment: string; verdictLabel?: string; refsResolved?: ResolvedRef[]; lawsResolved?: { id: string; text: string; url: string | null }[]; preceptsResolved?: { slug: string; title: string; url: string | null }[]; relatedCases?: { slug: string; name: string; desc: string }[]; taught?: { title: string; range: string; url: string }[]; see?: { title: string; url: string }[]; offenseFull?: string[]; judgmentFull?: string[]; related?: { slug: string; name: string; charge: string; url: string | null; desc?: string }[]; people?: { id: string; name: string }[] };
export type TopicRow = { slug: string; label: string; notes: number; cases: number; url: string };
/** One stop on a topic's thread: a scripture the classes on the topic opened, with the classes that opened it and the precepts read with it. */
export type ThreadStop = { book: string; chapter: number; verses: string; label: string; url: string; text: string; classes: { title: string; url: string; date: string; teacher: string; ts: string; video: string | null; t: number; points: number }[]; precepts: { label: string; url: string; why?: string }[] };
export type Topic = { slug: string; label: string; url: string; items: { kind: "class" | "captains" | "case"; title: string; url: string; date?: string | null; teacher?: string; charge?: string; verdict?: string }[]; thread?: ThreadStop[] };
export type EncyclopediaRow = { slug: string; title: string; url: string; summary: string };
export type Xref = Record<string, [string, number, number][]>;

const abs = <T extends { thumb: string }>(rows: T[]) => rows.map((r) => (r.thumb?.startsWith("/") ? { ...r, thumb: `${DATA_ORIGIN}${r.thumb}` } : r));

export const data = {
  books: () => get<Book[]>("/api/kjv/books.json").then(orderApocrypha),
  person: (id: string) => get<Person>(`/api/people/${id}.json`),
  people: () => get<PersonIndexRow[]>("/api/people/index.json"),
  library: () => get<LibraryRow[]>("/api/library/index.json"),
  strongs: (n: string) => get<StrongsEntry>(`/api/strongs/${n}.json`),
  strongsIndex: () => get<StrongsRow[]>("/api/strongs/index.json"),
  libraryBook: (slug: string) => get<LibraryBook>(`/api/library/${slug}/book.json`),
  libraryChapter: (slug: string, k: number) => get<LibraryChapter>(`/api/library/${slug}/chapter/${k}.json`),
  chapter: (slug: string, ch: number) => get<Chapter>(`/api/kjv/${slug}/${ch}.json`),
  xref: (slug: string, ch: number) => get<Xref>(`/api/xref/${slug}/${ch}.json`),
  /** The Greek of an Apocrypha chapter, verse by verse, from Swete's Septuagint (1909); 404 for the 66 books. */
  lxx: (slug: string, ch: number) => get<{ slug: string; chapter: number; source: string; verses: Record<string, string> }>(`/api/lxx/${slug}/${ch}.json`),
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
  /** Every law's words, for searching the handbook law by law. */
  lawTexts: () => get<{ id: string; text: string; url: string }[]>("/search/laws.json"),
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
