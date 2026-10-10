import { addAnnotation, removeAnnotation, verseAnnotations, type Annotation } from "@/studies/storage";
import { buildRangesFromSelection, type SelectionRange, type SelectionVerse } from "./selectionUtils";
import { tokenizeVerseText } from "./wordTokenizer";

/**
 * Bible Strong's CREATE_ANNOTATION and ERASE_SELECTION for the word selection, on our phrase
 * marks: one mark per verse the selection covers. Erasing trims the marks it overlaps, keeping
 * the words outside the selection marked, as Bible Strong does.
 */
const tokens = (_: string, text: string) => tokenizeVerseText(text);

export async function applyMarks(selection: SelectionRange, verses: SelectionVerse[], style: Annotation["style"], color: string) {
  const created = new Date().toISOString();
  for (const r of buildRangesFromSelection(selection, verses, tokens)) {
    const text = verses.find((v) => v.verseKey === r.verseKey)!.text;
    await addAnnotation({ id: crypto.randomUUID(), verseKey: r.verseKey, start: r.charStart, end: r.charEnd, quote: r.text, style, color, created }, text);
  }
}

/** The part of [start, end) left once whitespace at either edge is dropped, or null if only space. */
function trimmed(text: string, start: number, end: number): [number, number] | null {
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  return end > start ? [start, end] : null;
}

export async function eraseMarks(selection: SelectionRange, verses: SelectionVerse[]) {
  for (const r of buildRangesFromSelection(selection, verses, tokens)) {
    const text = verses.find((v) => v.verseKey === r.verseKey)!.text;
    for (const a of await verseAnnotations(r.verseKey)) {
      // Only the marks drawn on this text: one whose words no longer match it is never shown, so it is left alone.
      if (a.end <= r.charStart || a.start >= r.charEnd || text.slice(a.start, a.end) !== a.quote) continue;
      await removeAnnotation(a.id);
      for (const part of [trimmed(text, a.start, r.charStart), trimmed(text, r.charEnd, a.end)]) {
        if (!part) continue;
        await addAnnotation({ ...a, id: crypto.randomUUID(), start: part[0], end: part[1], quote: text.slice(part[0], part[1]) }, text);
      }
    }
  }
}
