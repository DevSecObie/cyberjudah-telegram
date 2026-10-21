import { allAnnotations, changeAnnotations, markId, type Annotation, type AnnotationNote } from "@/studies/storage";
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

const recordIds = (marks: Mark[]) => marks.flatMap(m => m.records.map(r => r.id));
const removeMark = (m: Mark) => changeAnnotations({ remove: recordIds([m]) });

/** CREATE_ANNOTATION: the new mark's id, after replacing the marks it covers. */
export async function applyMark(marks: Mark[], selection: SelectionRange, verses: SelectionVerse[], style: MarkStyle, color: string): Promise<string | null> {
  const ranges = buildRangesFromSelection(selection, verses, tokens);
  if (!ranges.length) return null;
  const replaced = marksInSelection(marks, selection, verses);
  const created = new Date().toISOString(), ids = ranges.map(() => crypto.randomUUID());
  const group = ranges.length > 1 ? crypto.randomUUID() : undefined;
  const add = ranges.map((r, i) => ({
    annotation: { id: ids[i], verseKey: r.verseKey, start: r.charStart, end: r.charEnd, quote: r.text, style, color, ...(group ? { group } : {}), created },
    text: verses.find((v) => v.verseKey === r.verseKey)!.text,
  }));
  await changeAnnotations({ add, remove: recordIds(replaced) });
  return group ?? ids[0];
}

/** ERASE_SELECTION: every mark the selection touches goes, whole. */
export async function eraseMarks(marks: Mark[], selection: SelectionRange, verses: SelectionVerse[]) {
  await changeAnnotations({ remove: recordIds(marksInSelection(marks, selection, verses)) });
}

export const deleteMark = removeMark;
/** Remove a deleted tag from every record, including every verse of a grouped word mark. */
export async function removeTagFromMarks(id: string) {
  const update = (await allAnnotations()).filter(record => record.tags?.[id]).map(record => {
    const tags = { ...record.tags }; delete tags[id];
    return { ...record, tags };
  });
  await changeAnnotations({ update });
}

export async function updateMark(m: Mark, change: Partial<Pick<Annotation, "style" | "color" | "note" | "tags">>) {
  const update = m.records.map(r => {
    const next: Annotation = { ...r, ...change };
    if (change.note === undefined && "note" in change) delete next.note;
    if (change.tags === undefined && "tags" in change) delete next.tags;
    return next;
  });
  await changeAnnotations({ update });
}

/** The mark's words, each verse's part trimmed and joined with " … " (wordAnnotationRanges.ts). */
export const markText = (m: Mark) => m.records.map((r) => r.quote.trim()).join(" … ");
/** The selection range a mark was drawn over, for the toolbar's reference. */
export const selectionVerses = (selection: SelectionRange, verses: SelectionVerse[]) => {
  const { start, end } = normalizeRange(selection, verses);
  const from = verseNo(start.verseKey), to = verseNo(end.verseKey);
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
};
