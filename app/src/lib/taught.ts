import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { data, verseNumbers, type ClassMoment, type Concordance, type Reading, type TaughtPrecept } from "@/api/data";
import { verseKey, type LinkEndpoint, type Relation, type VerseEndpoint, type VerseRelationItem } from "./relations";

/**
 * The precepts the classes lined up with a scripture, read from the chapter's concordance
 * and shown as relations under the verse, beside the ones the reader made. They are the
 * library's, not the reader's: no id in CloudStorage, nothing to edit, and the same for
 * everyone. A "precept" row is one taught under this verse; an "opened" row says this verse
 * was the precept when another scripture was opened.
 */
/** Whose teaching comes first: the Bishops', then the Deacons', then everyone else's. */
export const teacherRank = (teacher?: string | null) => (/^bishop\b/i.test(teacher ?? "") ? 0 : /^deacon\b/i.test(teacher ?? "") ? 1 : 2);

export const slugOfUrl = (url: string) => /^\/bible\/([a-z0-9-]+)\/(\d+)/.exec(url);

const concordance = (slug: string, ch: number) => ({ queryKey: ["taught", slug, ch], enabled: !!slug && ch > 0, staleTime: 3_600_000, queryFn: () => data.concordance(slug, ch).catch(() => null as Concordance | null) });
export function useTaughtPrecepts(slug: string, ch: number) {
  return useQuery({ ...concordance(slug, ch), select: (c: Concordance | null) => c?.precepts ?? ([] as TaughtPrecept[]) });
}
/** The moments classes read this chapter's verses, each with its recording at that second. */
export function useClassMoments(slug: string, ch: number) {
  return useQuery({ ...concordance(slug, ch), select: (c: Concordance | null) => c?.moments ?? ([] as ClassMoment[]) });
}
/** Every moment a class read each verse of this chapter aloud, from the transcripts: verse -> readings, Bishops first, then newest first. */
export function useReadings(slug: string, ch: number) {
  return useQuery({ ...concordance(slug, ch), select: (c: Concordance | null) => c?.read ?? ({} as Record<string, Reading[]>) });
}
/** Who is named in each verse of this chapter (person ids). */
export function usePeopleNamed(slug: string, ch: number) {
  return useQuery({ ...concordance(slug, ch), select: (c: Concordance | null) => c?.people ?? ({} as Record<string, string[]>) });
}
/** YouTube at the second the class read it. */
export const watchUrl = (m: ClassMoment) => `https://www.youtube.com/watch?v=${m.video}${m.t ? `&t=${m.t}s` : ""}`;

/** The precepts for one verse, deduplicated by the scripture they point to. */
export function preceptsForVerse(rows: TaughtPrecept[] | undefined, verse: number): TaughtPrecept[] {
  const out: TaughtPrecept[] = []; const seen = new Set<string>();
  for (const r of rows ?? []) {
    if (r.verses && !verseNumbers(r.verses).includes(verse)) continue;
    const k = `${r.kind}|${r.ref.url}|${r.note.url}`;
    if (seen.has(k)) continue; seen.add(k); out.push(r);
  }
  return out;
}

/** The precepts as relation items keyed by verse, in the shape the reader draws under a verse. */
export function useTaughtRelations(slug: string, ch: number, display: "inline" | "block"): Record<number, VerseRelationItem[]> {
  const q = useTaughtPrecepts(slug, ch);
  const moments = useClassMoments(slug, ch);
  return useMemo(() => {
    const out: Record<number, VerseRelationItem[]> = {};
    const seen = new Set<string>();
    for (const r of [...(q.data ?? [])].sort((a, b) => teacherRank(a.note.teacher) - teacherRank(b.note.teacher))) {
      const m = slugOfUrl(r.ref.url); if (!m) continue;
      const vs = r.verses ? verseNumbers(r.verses) : [];
      if (!vs.length) continue;
      const anchor = display === "inline" ? vs[vs.length - 1] : vs[0];
      const k = `${anchor}|${r.ref.url}`; if (seen.has(k)) continue; seen.add(k);
      const tvs = r.ref.verses ? verseNumbers(r.ref.verses) : [];
      const active: VerseEndpoint = { type: "verse", verseKeys: vs.map((v) => verseKey(slug, ch, v)), label: `${r.ref.book} ${ch}:${r.verses}` };
      const target: VerseEndpoint = { type: "verse", verseKeys: (tvs.length ? tvs : [1]).map((v) => verseKey(m[1], +m[2], v)), label: r.ref.label };
      const relation: Relation = { id: `taught:${slug}-${ch}-${anchor}:${r.ref.url}`, type: "references", direction: r.kind === "precept" ? "forward" : "backward", endpoints: [active, target], label: r.note.label, createdAt: 0, updatedAt: 0 };
      (out[anchor] ??= []).push({ key: relation.id, relation, active, target, label: r.ref.label, updatedAt: 0 });
    }
    // Each verse with precepts leads with one note, "Precept(s)": why each is there, in a line or two.
    for (const [v, items] of Object.entries(out)) {
      const anchor = +v;
      const label = items.length > 1 ? "Precepts" : "Precept";
      const active: VerseEndpoint = { type: "verse", verseKeys: [verseKey(slug, ch, anchor)], label: `${ch}:${anchor}` };
      const target = { type: "note" as const, verseKey: verseKey(slug, ch, anchor), label };
      const relation: Relation = { id: `${WHY}${slug}-${ch}-${anchor}`, type: "explains", direction: "forward", endpoints: [active, target], label, createdAt: 0, updatedAt: 0 };
      items.unshift({ key: relation.id, relation, active, target, label, updatedAt: 0 });
    }
    // Then a link for each class that read the verse, to its recording at that moment, newest first.
    const heard = new Set<string>();
    for (const m of [...(moments.data ?? [])].sort((a, b) => teacherRank(a.teacher) - teacherRank(b.teacher) || b.date.localeCompare(a.date))) {
      const vs = m.verses ? verseNumbers(m.verses) : [1];
      if (!vs.length) continue;
      const anchor = display === "inline" ? vs[vs.length - 1] : vs[0];
      const k = `${anchor}|${m.video}`; if (heard.has(k)) continue; heard.add(k);
      const active: VerseEndpoint = { type: "verse", verseKeys: vs.map((v) => verseKey(slug, ch, v)), label: `${ch}:${m.verses || anchor}` };
      const target: LinkEndpoint = { type: "link", url: watchUrl(m), label: m.label };
      const relation: Relation = { id: `taught:watch:${slug}-${ch}-${anchor}:${m.video}`, type: "linked", direction: "forward", endpoints: [active, target], label: `${m.label} · ${m.ts}`, createdAt: 0, updatedAt: 0 };
      (out[anchor] ??= []).push({ key: relation.id, relation, active, target, label: m.label, updatedAt: 0 });
    }
    return out;
  }, [q.data, moments.data, slug, ch, display]);
}

/** The note that leads a verse's precepts: why each is there. */
export const WHY = "taught-why:";
export const isWhy = (r: Relation) => r.id.startsWith(WHY);
/** The verse a "why" note is about. */
export const whyVerse = (r: Relation) => Number(r.id.split("-").pop());

/** A relation the library made, as opposed to one the reader made. */
export const isTaught = (r: Relation) => r.id.startsWith("taught:") || r.id.startsWith(WHY);

/**
 * The classes that taught each verse, for the pictures after it (Bible Strong's inline videos):
 * keyed by the last verse the moment taught, the Bishops' and Deacons' first, newest first, one
 * picture per class and verse, at most MOMENTS_PER_VERSE.
 */
export const MOMENTS_PER_VERSE = 6;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
export function momentsByVerse(list: ClassMoment[], limit = MOMENTS_PER_VERSE): Record<number, ClassMoment[]> {
  const out: Record<number, ClassMoment[]> = {};
  const seen = new Set<string>();
  const sorted = list
    .filter((m) => VIDEO_ID.test(m.video ?? "") && Number.isFinite(m.t) && verseNumbers(m.verses).length > 0)
    .sort((a, b) => teacherRank(a.teacher) - teacherRank(b.teacher) || (b.date ?? "").localeCompare(a.date ?? "") || a.t - b.t);
  for (const m of sorted) {
    const end = Math.max(...verseNumbers(m.verses));
    if (seen.has(`${end}:${m.video}`)) continue;
    seen.add(`${end}:${m.video}`);
    const row = (out[end] ??= []);
    if (row.length < limit) row.push(m);
  }
  return out;
}
export function useMomentsByVerse(slug: string, ch: number) {
  return useQuery({ ...concordance(slug, ch), select: (c: Concordance | null) => momentsByVerse(c?.moments ?? []) });
}

/**
 * Every class that read a verse, not only those with notes: the classes whose notes break the
 * verse down first, then every other class the transcripts find reading it aloud (the Bishops'
 * and Deacons' first, newest first), one picture per class and verse. A class without notes has
 * no url; its picture plays the recording at that moment, and its readers can ask for notes.
 */
const fromReading = (verse: number, r: Reading): ClassMoment => ({ verses: String(verse), label: r.title, url: r.url ?? "", date: r.date, video: r.video, t: r.t, ts: r.ts, teacher: r.teacher });
export function classesByVerse(c: Concordance | null): Record<number, ClassMoment[]> {
  const out = momentsByVerse(c?.moments ?? [], Infinity);
  for (const [v, list] of Object.entries(c?.read ?? {})) {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1) continue;
    const row = (out[n] ??= []);
    const have = new Set(row.map((m) => m.video));
    for (const r of list) if (VIDEO_ID.test(r.video ?? "") && Number.isFinite(r.t) && !have.has(r.video)) { have.add(r.video); row.push(fromReading(n, r)); }
  }
  return out;
}
export function useClassesByVerse(slug: string, ch: number) {
  return useQuery({ ...concordance(slug, ch), select: classesByVerse });
}
/** A chapter's classes, once each: those whose notes teach it, then those that read it aloud. */
export function chapterClasses(byVerse: Record<number, ClassMoment[]>): { taught: ClassMoment[]; read: ClassMoment[] } {
  const all = Object.entries(byVerse).sort(([a], [b]) => +a - +b).flatMap(([, ms]) => ms);
  const seen = new Set<string>(), taught: ClassMoment[] = [], read: ClassMoment[] = [];
  for (const m of all) if (m.url && !seen.has(m.video)) { seen.add(m.video); taught.push(m); }
  const rest = all.filter((m) => !seen.has(m.video))
    .sort((a, b) => teacherRank(a.teacher) - teacherRank(b.teacher) || (b.date ?? "").localeCompare(a.date ?? ""));
  for (const m of rest) if (!seen.has(m.video)) { seen.add(m.video); read.push(m); }
  return { taught, read };
}
/** YouTube's medium thumbnail of a recording (320 x 180), as WebP. */
export const thumbUrl = (video: string) => `https://i.ytimg.com/vi_webp/${encodeURIComponent(video)}/mqdefault.webp`;
