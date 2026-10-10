import { addAnnotation, markId, removeAnnotation, updateAnnotation, type Annotation, type AnnotationNote } from "@/studies/storage";
import { buildRangesFromSelection, normalizeRange, type SelectionRange, type SelectionVerse } from "./selectionUtils";
import { tokenizeVerseText } from "./wordTokenizer";

/**
 * Bible Strong's word annotations (redux/modules/user/wordAnnotations.ts) on our word-mark
 * records: a mark is every record sharing `markId`, one per verse it covers, in verse order.
 * - Drawing over marks replaces them, whatever their colour or kind (ADD with
 *   findOverlappingWordAnnotationIds): they are removed whole, with their note.
 * - Erasing removes every mark the selection touches, whole.
 * - A colour or kind change rewrites the mark in place.
 */
export type MarkStyle = Annotation["style"];
export type Mark = { id: string; records: Annotation[]; style: MarkStyle; color?: string; note?: AnnotationNote; tags?: Record<string, true>; created: string };

const tokens = (_: string, text: string) => tokenizeVerseText(text);
const verseNo = (k: string) => Number(k.slice(k.lastIndexOf("-") + 1));

/** Records grouped into marks, each mark's records in verse order. */
export function groupMarks(records: Annotation[]): Mark[] {
  const by = new Map<string, Annotation[]>();
  for (const r of records) { const id = markId(r); by.set(id, [...(by.get(id) ?? []), r]); }
  return [...by.entries()].map(([id, rs]) => {
    rs.sort((a, b) => verseNo(a.verseKey) - verseNo(b.verseKey) || a.start - b.start);
    const first = rs[0];
    return { id, records: rs, style: first.style, color: first.color, note: first.note, tags: first.tags, created: first.created };
  });
}

/** The marks the selection's span touches (findOverlappingWordAnnotationIds). */
export function marksInSelection(marks: Mark[], selection: SelectionRange, verses: SelectionVerse[]): Mark[] {
  const ranges = buildRangesFromSelection(selection, verses, tokens);
  return marks.filter((m) => m.records.some((a) => ranges.some((r) => r.verseKey === a.verseKey && a.start < r.charEnd && a.end > r.charStart)));
}

async function removeMark(m: Mark) { for (const r of m.records) await removeAnnotation(r.id); }

/** CREATE_ANNOTATION: the new mark's id, after replacing the marks it covers. */
export async function applyMark(marks: Mark[], selection: SelectionRange, verses: SelectionVerse[], style: MarkStyle, color: string): Promise<string | null> {
  const ranges = buildRangesFromSelection(selection, verses, tokens);
  if (!ranges.length) return null;
  for (const m of marksInSelection(marks, selection, verses)) await removeMark(m);
  const created = new Date().toISOString(), ids = ranges.map(() => crypto.randomUUID());
  const group = ranges.length > 1 ? crypto.randomUUID() : undefined;
  for (const [i, r] of ranges.entries()) {
    const text = verses.find((v) => v.verseKey === r.verseKey)!.text;
    await addAnnotation({ id: ids[i], verseKey: r.verseKey, start: r.charStart, end: r.charEnd, quote: r.text, style, color, ...(group ? { group } : {}), created }, text);
  }
  return group ?? ids[0];
}

/** ERASE_SELECTION: every mark the selection touches goes, whole. */
export async function eraseMarks(marks: Mark[], selection: SelectionRange, verses: SelectionVerse[]) {
  for (const m of marksInSelection(marks, selection, verses)) await removeMark(m);
}

export const deleteMark = removeMark;
export async function updateMark(m: Mark, change: Partial<Pick<Annotation, "style" | "color" | "note" | "tags">>) {
  for (const r of m.records) {
    const next: Annotation = { ...r, ...change };
    if (change.note === undefined && "note" in change) delete next.note;
    if (change.tags === undefined && "tags" in change) delete next.tags;
    await updateAnnotation(next);
  }
}

/** The mark's words, each verse's part trimmed and joined with " … " (wordAnnotationRanges.ts). */
export const markText = (m: Mark) => m.records.map((r) => r.quote.trim()).join(" … ");
/** The verses a mark covers, in order. */
export const markVerses = (m: Mark) => [...new Set(m.records.map((r) => verseNo(r.verseKey)))];
/** The selection range a mark was drawn over, for the toolbar's reference. */
export const selectionVerses = (selection: SelectionRange, verses: SelectionVerse[]) => {
  const { start, end } = normalizeRange(selection, verses);
  const from = verseNo(start.verseKey), to = verseNo(end.verseKey);
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
};
