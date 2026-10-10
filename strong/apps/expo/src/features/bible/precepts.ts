import type { PreceptMarker } from './BibleDOM/PreceptsText'

/**
 * CyberJudah: the precepts the classes read with each verse of a chapter. Each one is a section of
 * the CyberJudah commentary (bot/src/bs/commentary.ts), so it opens in Bible Strong's commentary reader.
 */
export type ChapterPrecepts = {
  resource: { resourceId: string; language: 'en'; revision: string }
  sections: { id: string; rangeStartVerse: number; rangeEndVerse: number; excerpt: string }[]
  precepts: (PreceptMarker & { verse: number })[]
}

// Served by the Worker beside the app itself, so the request is same-origin.
export const fetchChapterPrecepts = async (
  book: number,
  chapter: number
): Promise<ChapterPrecepts> => {
  const response = await fetch(`/bs/v1/commentaries/cyberjudah/en/precepts/${book}/${chapter}`)
  if (!response.ok) throw new Error(`Precepts ${book}:${chapter}: ${response.status}`)
  return response.json()
}

export const preceptsAfterVerses = (data: ChapterPrecepts | undefined) => {
  const after: Record<number, PreceptMarker[]> = {}
  for (const { verse, label, sectionId } of data?.precepts ?? [])
    (after[verse] ??= []).push({ label, sectionId })
  return after
}
