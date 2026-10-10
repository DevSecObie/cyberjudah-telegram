// CyberJudah: a reader's highlights, notes, links, bookmarks and tags from the CyberJudah Telegram
// app, converted into this app's own shapes (redux user.bible). The Telegram app kept them as
// Bible Strong's shapes already, one Telegram CloudStorage value per chapter, with its own
// verse keys (book slug, chapter, verse numbers); here they get Bible Strong's numeric keys.
//
//   bs_h_<slug>_<ch>   highlights: "16" -> { color, date, tags?: { id: true } }
//   bs_n_<slug>_<ch>   notes: "16/17" -> { id, title, description, date, tags? }
//   bs_l_<slug>_<ch>   links: "16" -> { id, url, title, linkType, date, tags? }
//   bs_bm              bookmarks: [{ id, name, color, book: slug, chapter, verse?, date }]
//   bs_tags            tags: id -> { id, name, date }
//   bs                 reader settings (only the custom highlight colours are taken)
//   hl                 the first highlights: "<slug>/<ch>" -> "16:y,17-18:g" (used where a chapter
//                      has no bs_h_ value, as the Telegram app does)
//   nt_<slug>_<ch>     the first notes: "16" -> text (used where a verse has no note)
//
// Nothing here writes anywhere: the result is merged by mergeImportedBibleData, which never
// replaces what this app already holds.

import type { CustomColor, HighlightsObj, LinkType, LinksObj, NotesObj } from '~redux/modules/user'
import type { BookmarksObj, TagsObj } from '~common/types'
import { bookNumberOfSlug } from './bookSlugs'

export const TELEGRAM_IMPORT_VERSION = 1

export type ImportedBibleData = {
  highlights: HighlightsObj
  notes: NotesObj
  links: LinksObj
  bookmarks: BookmarksObj
  tags: TagsObj
  customHighlightColors: CustomColor[]
}

/** Whether a Telegram app key holds something this import reads. */
export const isImportedKey = (key: string): boolean =>
  /^bs_[hnl]_.+_\d+$/.test(key) ||
  /^nt_.+_\d+$/.test(key) ||
  key === 'bs_bm' ||
  key === 'bs_tags' ||
  key === 'bs' ||
  key === 'hl'

/** The first highlights' one-letter colours, as the Telegram app maps them. */
const OLD_COLORS: Record<string, string> = {
  y: 'color3',
  g: 'color1',
  b: 'color4',
  p: 'color2',
  o: 'color3',
  v: 'color5',
}
const LINK_TYPES: LinkType[] = ['youtube', 'twitter', 'instagram', 'tiktok', 'vimeo', 'spotify', 'facebook', 'linkedin', 'github', 'website']

const parse = (raw: string | undefined): unknown => {
  if (!raw) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

/** "16", "16/17" or "16-18" (verse numbers in one chapter) as Bible Strong's keys. */
const verseNumbers = (spec: string): number[] => {
  const out: number[] = []
  for (const part of spec.split(/[/,]/)) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part.trim())
    if (!m) return []
    for (let v = +m[1]; v <= (m[2] ? +m[2] : +m[1]); v++) out.push(v)
  }
  return out
}
const keyOf = (book: number, chapter: number, verses: number[]) =>
  verses.map(v => `${book}-${chapter}-${v}`).join('/')

/** "bs_h_john_3" -> book 43, chapter 3. */
const chapterOfKey = (prefix: string, key: string): { book: number; chapter: number } | undefined => {
  const m = new RegExp(`^${prefix}(.+)_(\\d+)$`).exec(key)
  const book = m ? bookNumberOfSlug(m[1]) : undefined
  return m && book ? { book, chapter: Number(m[2]) } : undefined
}

export function convertTelegramData(values: Record<string, string>): ImportedBibleData {
  const out: ImportedBibleData = { highlights: {}, notes: {}, links: {}, bookmarks: {}, tags: {}, customHighlightColors: [] }

  // Tags first: highlights, notes and links carry them as { id: { id, name } }.
  const tagRows = parse(values.bs_tags)
  if (isRecord(tagRows)) {
    for (const [id, t] of Object.entries(tagRows)) {
      if (!isRecord(t) || !str(t.name)) continue
      out.tags[id] = { id, name: str(t.name)!, ...(num(t.date) !== undefined ? { date: num(t.date) } : {}) }
    }
  }
  const tagsOf = (raw: unknown, kind: 'highlights' | 'notes' | 'links', key: string) => {
    if (!isRecord(raw)) return undefined
    const tags: TagsObj = {}
    for (const id of Object.keys(raw)) {
      const tag = out.tags[id]
      if (!tag) continue
      tags[id] = { id, name: tag.name }
      tag[kind] = { ...(tag[kind] ?? {}), [key]: true }
    }
    return Object.keys(tags).length ? tags : undefined
  }

  const chaptersWithHighlights = new Set<string>()
  for (const [key, raw] of Object.entries(values)) {
    const at = chapterOfKey('bs_h_', key)
    if (at) {
      chaptersWithHighlights.add(`${at.book}-${at.chapter}`)
      const rows = parse(raw)
      if (!isRecord(rows)) continue
      for (const [verse, h] of Object.entries(rows)) {
        const verses = verseNumbers(verse)
        if (!isRecord(h) || !str(h.color) || verses.length !== 1) continue
        const vk = keyOf(at.book, at.chapter, verses)
        const tags = tagsOf(h.tags, 'highlights', vk)
        out.highlights[vk] = { color: str(h.color)!, date: num(h.date) ?? 0, version: 'KJV', ...(tags ? { tags } : {}) }
      }
      continue
    }
    const noteAt = chapterOfKey('bs_n_', key)
    if (noteAt) {
      const rows = parse(raw)
      if (!isRecord(rows)) continue
      for (const [spec, n] of Object.entries(rows)) {
        const verses = verseNumbers(spec)
        if (!isRecord(n) || !verses.length) continue
        const vk = keyOf(noteAt.book, noteAt.chapter, verses)
        const tags = tagsOf(n.tags, 'notes', vk)
        out.notes[vk] = {
          ...(str(n.id) ? { id: str(n.id) } : {}),
          title: str(n.title) ?? '',
          description: str(n.description) ?? '',
          date: num(n.date) ?? 0,
          version: 'KJV',
          ...(tags ? { tags } : {}),
        }
      }
      continue
    }
    const linkAt = chapterOfKey('bs_l_', key)
    if (linkAt) {
      const rows = parse(raw)
      if (!isRecord(rows)) continue
      for (const [spec, l] of Object.entries(rows)) {
        const verses = verseNumbers(spec)
        if (!isRecord(l) || !str(l.url) || !verses.length) continue
        const vk = keyOf(linkAt.book, linkAt.chapter, verses)
        const tags = tagsOf(l.tags, 'links', vk)
        const linkType = LINK_TYPES.includes(l.linkType as LinkType) ? (l.linkType as LinkType) : 'website'
        out.links[vk] = {
          ...(str(l.id) ? { id: str(l.id) } : {}),
          url: str(l.url)!,
          ...(str(l.title) ? { customTitle: str(l.title) } : {}),
          linkType,
          date: num(l.date) ?? 0,
          version: 'KJV',
          ...(tags ? { tags } : {}),
        }
      }
    }
  }

  // The first highlights, for chapters that never got a bs_h_ value.
  const legacy = parse(values.hl)
  if (isRecord(legacy)) {
    for (const [chapterKey, spec] of Object.entries(legacy)) {
      const m = /^(.+)\/(\d+)$/.exec(chapterKey)
      const book = m ? bookNumberOfSlug(m[1]) : undefined
      if (!m || !book || typeof spec !== 'string' || chaptersWithHighlights.has(`${book}-${m[2]}`)) continue
      for (const part of spec.split(',')) {
        const [range, letter = 'y'] = part.split(':')
        for (const v of verseNumbers(range)) {
          const vk = keyOf(book, Number(m[2]), [v])
          out.highlights[vk] ??= { color: OLD_COLORS[letter] ?? 'color3', date: 0, version: 'KJV' }
        }
      }
    }
  }

  // The first notes: plain text on one verse, where that verse has no note.
  for (const [key, raw] of Object.entries(values)) {
    const at = chapterOfKey('nt_', key)
    const rows = at ? parse(raw) : undefined
    if (!at || !isRecord(rows)) continue
    for (const [verse, text] of Object.entries(rows)) {
      const verses = verseNumbers(verse)
      if (typeof text !== 'string' || !text.trim() || verses.length !== 1) continue
      const vk = keyOf(at.book, at.chapter, verses)
      if (Object.keys(out.notes).some(k => k.split('/').includes(vk))) continue
      out.notes[vk] = { title: '', description: text, date: 0, version: 'KJV' }
    }
  }

  const bookmarks = parse(values.bs_bm)
  if (Array.isArray(bookmarks)) {
    for (const b of bookmarks) {
      if (!isRecord(b) || !str(b.id) || !str(b.book)) continue
      const book = bookNumberOfSlug(str(b.book)!)
      const chapter = num(b.chapter)
      if (!book || !chapter) continue
      out.bookmarks[str(b.id)!] = {
        id: str(b.id)!,
        name: str(b.name) ?? '',
        color: str(b.color) ?? '#cc0000',
        book,
        chapter,
        ...(num(b.verse) !== undefined ? { verse: num(b.verse) } : {}),
        date: num(b.date) ?? 0,
        createdAt: num(b.date) ?? 0,
        version: 'KJV',
      }
    }
  }

  const settings = parse(values.bs)
  if (isRecord(settings) && Array.isArray(settings.customHighlightColors)) {
    for (const c of settings.customHighlightColors) {
      if (!isRecord(c) || !str(c.id) || !str(c.hex)) continue
      const type = c.type === 'textColor' || c.type === 'underline' ? c.type : 'background'
      out.customHighlightColors.push({ id: str(c.id)!, hex: str(c.hex)!, createdAt: 0, type, ...(str(c.name) ? { name: str(c.name) } : {}) })
    }
  }

  return out
}

export const countImported = (data: ImportedBibleData) =>
  Object.keys(data.highlights).length +
  Object.keys(data.notes).length +
  Object.keys(data.links).length +
  Object.keys(data.bookmarks).length +
  Object.keys(data.tags).length
