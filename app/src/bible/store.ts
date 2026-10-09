import { useCallback, useEffect, useMemo, useState } from "react";

import { useStored } from "@/tg/hooks";
import { json, store } from "@/tg/store";
import { parseHl, type Highlights } from "@/lib/marks";
import { parseVerseKey, verseKey } from "@/lib/relations";

/**
 * The reader's study data, shaped as Bible Strong's `user.bible` (highlights, notes, links,
 * bookmarks, tags) and kept in CloudStorage per chapter so each value stays under 4 KB:
 *   bs_h_<book>_<chapter>   highlights: verse number -> { color, date, tags }
 *   bs_n_<book>_<chapter>   notes: "16/17" (verse numbers) -> { id, title, description, date, tags }
 *   bs_l_<book>_<chapter>   links: "16" -> { id, url, title, linkType, date, tags }
 *   bs_bm                   bookmarks (8 at most, as Bible Strong's MAX_BOOKMARKS)
 *   bs_tags                 tags: id -> { id, name, date }
 * Verse keys are `<book>-<chapter>-<verse>`, the app's own (lib/relations).
 */
export type Highlight = { color: string; date: number; tags?: Record<string, true> };
export type Note = { id: string; title: string; description: string; date: number; tags?: Record<string, true> };
export type Link = { id: string; url: string; title: string; linkType: string; date: number; tags?: Record<string, true> };
export type Bookmark = { id: string; name: string; color: string; book: string; chapter: number; verse?: number; date: number };
export type Tag = { id: string; name: string; date: number };
export const MAX_BOOKMARKS = 8;
export const DEFAULT_BOOKMARK_COLOR = "#cc0000";

export const uuid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

const hKey = (slug: string, ch: number) => `bs_h_${slug}_${ch}`;
const nKey = (slug: string, ch: number) => `bs_n_${slug}_${ch}`;
const lKey = (slug: string, ch: number) => `bs_l_${slug}_${ch}`;

/** The first highlights (one letter per colour) become Bible Strong colour ids, once. */
const OLD_COLORS: Record<string, string> = { y: "color3", g: "color1", b: "color4", p: "color2", o: "color3", v: "color5" };

export function useChapterHighlights(slug: string, ch: number): [Record<string, Highlight>, (next: Record<string, Highlight>) => void] {
  const [hl, setHl, loaded] = useStored<Record<string, Highlight>>(hKey(slug, ch), {});
  const [old] = useStored<Highlights>("hl", {});
  useEffect(() => {
    if (!loaded || Object.keys(hl).length || store.hasPersonalKey(hKey(slug, ch))) return;
    const legacy = parseHl(old[`${slug}/${ch}`]);
    if (!legacy.size) return;
    const next: Record<string, Highlight> = {};
    for (const [v, c] of legacy) next[String(v)] = { color: OLD_COLORS[c] ?? "color3", date: Date.now() };
    setHl(next);
  }, [loaded, old, slug, ch]); // eslint-disable-line react-hooks/exhaustive-deps
  return [hl, setHl];
}
export const useChapterNotes = (slug: string, ch: number) => useStored<Record<string, Note>>(nKey(slug, ch), {});
export const useChapterLinks = (slug: string, ch: number) => useStored<Record<string, Link>>(lKey(slug, ch), {});
export const useBookmarks = () => useStored<Bookmark[]>("bs_bm", []);
export const useTags = () => useStored<Record<string, Tag>>("bs_tags", {});

/** Verse numbers of a note or link key ("16/17" -> [16, 17]). */
export const versesOfKey = (k: string) => k.split("/").map(Number);
export const keyOfVerses = (vs: number[]) => [...vs].sort((a, b) => a - b).join("/");

export async function readNote(verseKeyOrKey: string): Promise<{ slug: string; chapter: number; key: string; note: Note } | null> {
  const p = parseVerseKey(verseKeyOrKey);
  if (!p) return null;
  const notes = await json.get<Record<string, Note>>(nKey(p.slug, p.chapter), {});
  const key = Object.keys(notes).find((k) => versesOfKey(k).includes(p.verse));
  return key ? { slug: p.slug, chapter: p.chapter, key, note: notes[key] } : null;
}
export async function writeNote(slug: string, ch: number, key: string, note: Note | null) {
  const notes = await json.get<Record<string, Note>>(nKey(slug, ch), {});
  if (note) notes[key] = note; else delete notes[key];
  await json.set(nKey(slug, ch), notes);
}

/** Every note and link across the library, for the notes list and the relation picker. */
export function useAllNotes() {
  const [rows, setRows] = useState<{ slug: string; chapter: number; key: string; note: Note }[]>([]);
  const reload = useCallback(() => {
    void store.keys().then(async (keys) => {
      const out: { slug: string; chapter: number; key: string; note: Note }[] = [];
      for (const k of keys.filter((x) => x.startsWith("bs_n_"))) {
        const m = /^bs_n_(.+)_(\d+)$/.exec(k); if (!m) continue;
        const notes = await json.get<Record<string, Note>>(k, {});
        for (const [key, note] of Object.entries(notes)) out.push({ slug: m[1], chapter: +m[2], key, note });
      }
      setRows(out.sort((a, b) => b.note.date - a.note.date));
    });
  }, []);
  useEffect(reload, [reload]);
  return { rows, reload };
}

/** Link types as Bible Strong detects them from the URL (helpers/linkTypeConfig). */
export function detectLinkType(url: string): string {
  let host = "";
  try { host = new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return "website"; }
  if (/youtube\.com|youtu\.be/.test(host)) return "youtube";
  if (/twitter\.com|x\.com/.test(host)) return "twitter";
  if (/instagram\.com/.test(host)) return "instagram";
  if (/tiktok\.com/.test(host)) return "tiktok";
  if (/vimeo\.com/.test(host)) return "vimeo";
  if (/spotify\.com/.test(host)) return "spotify";
  if (/facebook\.com|fb\.com/.test(host)) return "facebook";
  if (/linkedin\.com/.test(host)) return "linkedin";
  if (/github\.com/.test(host)) return "github";
  return "website";
}

/** Bible Strong's verseToReference: "John 3:1,3-5", chapters joined with "; ". */
export function compactVerses(verses: number[]): string {
  const a = [...new Set(verses)].sort((x, y) => x - y);
  return a.reduce((acc, v, i) => {
    if (v === a[i - 1] + 1 && v === a[i + 1] - 1) return acc;
    if (v === a[i - 1] + 1 && v !== a[i + 1] - 1) return `${acc}-${v}`;
    if (a[i - 1] !== undefined && v - 1 !== a[i - 1]) return `${acc},${v}`;
    return acc + v;
  }, "");
}
export function verseToReference(keys: string[], bookName: (slug: string) => string): string {
  const groups = new Map<string, { slug: string; chapter: number; verses: number[] }>();
  for (const k of keys) { const p = parseVerseKey(k); if (!p) continue; const g = groups.get(`${p.slug}-${p.chapter}`) ?? { slug: p.slug, chapter: p.chapter, verses: [] }; g.verses.push(p.verse); groups.set(`${p.slug}-${p.chapter}`, g); }
  return [...groups.values()].map((g) => `${bookName(g.slug)} ${g.chapter}:${compactVerses(g.verses)}`).join("; ");
}

/** getVersesContent: the text of a selection, formatted per the share options. */
export function versesContent(sel: { verse: number; text: string }[], reference: string, o: { hasVerseNumbers: boolean; hasInlineVerses: boolean; hasQuotes: boolean; hasAppName: boolean }) {
  let content = "";
  sel.forEach((v, i) => {
    const last = i === sel.length - 1;
    const inline = o.hasInlineVerses && !last ? "" : "\n";
    const num = o.hasVerseNumbers ? `${v.verse}. ` : "";
    const qs = o.hasQuotes && i === 0 ? "« " : "", qe = o.hasQuotes && last ? " »" : "";
    content += `${qs}${num}${v.text}${qe}${inline} `;
  });
  return { title: reference, content, all: `${content} \n${reference} KJV ${o.hasAppName ? "\n\nhttps://cyberjudah.io" : ""}` };
}

export const selectionKeys = (slug: string, ch: number, verses: number[]) => verses.map((v) => verseKey(slug, ch, v));

export function useVerseList(verses: number[]) { return useMemo(() => [...verses].sort((a, b) => a - b), [verses]); }
