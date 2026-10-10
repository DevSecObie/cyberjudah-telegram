import type { PreceptChip } from './BibleDOM/PreceptsText'

/**
 * CyberJudah: what the classes taught about each verse of a chapter (bot/src/bs/precepts.ts),
 * drawn under each verse as the app has always shown it, and the "Precept(s)" note of one verse.
 * Served by the Worker beside the app itself, so the requests are same-origin.
 */
export type ChapterPrecepts = { book: number; chapter: number; verses: Record<string, PreceptChip[]> }

export type PreceptClass = { label: string; date: string; teacher: string; ts: string; path: string }
export type VersePrecepts = {
  reference: string
  title: string
  leads: { point: string; class: PreceptClass }[]
  items: {
    kind: 'precept' | 'opened'
    label: string
    osis?: string
    words: string
    why: string
    class: PreceptClass
    more: number
  }[]
}

const get = async <T>(path: string): Promise<T> => {
  const response = await fetch(`/bs/v1/commentaries/cyberjudah/en/precepts/${path}`)
  if (!response.ok) throw new Error(`Precepts ${path}: ${response.status}`)
  return response.json()
}
export const fetchChapterPrecepts = (book: number, chapter: number) =>
  get<ChapterPrecepts>(`${book}/${chapter}`)
export const fetchVersePrecepts = (book: number, chapter: number, verse: number) =>
  get<VersePrecepts>(`${book}/${chapter}/${verse}`)

export const preceptsAfterVerses = (data: ChapterPrecepts | undefined) => {
  const after: Record<number, PreceptChip[]> = {}
  for (const [verse, chips] of Object.entries(data?.verses ?? {})) after[Number(verse)] = chips
  return after
}

/** A class's date as the app writes it ("Oct 9, 2026" in English). */
export const formatClassDate = (date: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date)
  return m
    ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      })
    : date
}
