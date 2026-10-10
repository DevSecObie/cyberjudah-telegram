// Copied from Bible Strong (apps/expo/src/features/bible/BibleDOM/AnnotationMode/selectionUtils.ts),
// with our verse rows ({ verseKey, text }) in place of Bible Strong's Livre/Chapitre/Verset/Texte.

import { type WordToken, getTokenByWordIndex } from "./wordTokenizer";

export type SelectionVerse = { verseKey: string; text: string };

export interface WordPosition {
  verseKey: string
  wordIndex: number
}

export interface SelectionRange {
  start: WordPosition
  end: WordPosition
}

export interface AnnotationRangeData {
  verseKey: string
  startWordIndex: number
  endWordIndex: number
  /** Character offsets in the verse text, for our phrase-mark storage. */
  charStart: number
  charEnd: number
  text: string
}

/** Returns negative if a < b, 0 if equal, positive if a > b */
export function comparePositions(a: WordPosition, b: WordPosition, verses: SelectionVerse[]): number {
  const aVerseIdx = verses.findIndex(v => v.verseKey === a.verseKey)
  const bVerseIdx = verses.findIndex(v => v.verseKey === b.verseKey)

  if (aVerseIdx !== bVerseIdx) {
    return aVerseIdx - bVerseIdx
  }
  return a.wordIndex - b.wordIndex
}

export function normalizeRange(
  range: SelectionRange,
  verses: SelectionVerse[]
): { start: WordPosition; end: WordPosition } {
  if (comparePositions(range.start, range.end, verses) > 0) {
    return { start: range.end, end: range.start }
  }
  return { start: range.start, end: range.end }
}

export function getVersesBetween(allVerses: SelectionVerse[], startKey: string, endKey: string): SelectionVerse[] {
  const startIdx = allVerses.findIndex(v => v.verseKey === startKey)
  const endIdx = allVerses.findIndex(v => v.verseKey === endKey)

  if (startIdx === -1 || endIdx === -1) return []

  const minIdx = Math.min(startIdx, endIdx)
  const maxIdx = Math.max(startIdx, endIdx)

  return allVerses.slice(minIdx, maxIdx + 1)
}

export function buildRangesFromSelection(
  selection: SelectionRange,
  verses: SelectionVerse[],
  getTokens: (verseKey: string, text: string) => WordToken[]
): AnnotationRangeData[] {
  const { start: normalizedStart, end: normalizedEnd } = normalizeRange(selection, verses)
  const selectedVerses = getVersesBetween(verses, normalizedStart.verseKey, normalizedEnd.verseKey)
  const ranges: AnnotationRangeData[] = []

  selectedVerses.forEach((verse, idx) => {
    const verseKey = verse.verseKey
    const tokens = getTokens(verseKey, verse.text)
    const wordTokens = tokens.filter(t => !t.isWhitespace)
    if (wordTokens.length === 0) return

    const isFirst = idx === 0
    const isLast = idx === selectedVerses.length - 1

    const startWordIdx = isFirst ? normalizedStart.wordIndex : 0
    const endWordIdx = isLast ? normalizedEnd.wordIndex : wordTokens[wordTokens.length - 1].index

    const startToken = getTokenByWordIndex(tokens, startWordIdx)
    const endToken = getTokenByWordIndex(tokens, endWordIdx)
    if (!startToken || !endToken) return

    const text = verse.text.substring(startToken.charStart, endToken.charEnd)

    ranges.push({
      verseKey,
      startWordIndex: startWordIdx,
      endWordIndex: endWordIdx,
      charStart: startToken.charStart,
      charEnd: endToken.charEnd,
      text,
    })
  })

  return ranges
}
