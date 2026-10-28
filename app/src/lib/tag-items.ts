import { compressVerses } from "@/api/data";
import { noteVerses, type Highlight, type Link, type Note } from "@/bible/store";
import { allAnnotations, changeAnnotations, markId, type Annotation } from "@/studies/storage";
import { json, store } from "@/tg/store";
import { parseVerseKey } from "./relations";

/**
 * What carries a tag, read from everything kept: Bible Strong's makeTagDataSelector over the kinds
 * we have (highlights, notes, links and word marks). A highlight made at one moment over several
 * verses is one highlight, as Bible Strong counts them; a word mark over several verses is one mark.
 */
export type TaggedHighlight = { date: number; color: string; tags?: Record<string, true>; verses: { slug: string; chapter: number; verse: number }[] };
export type TaggedNote = { slug: string; chapter: number; key: string; note: Note };
export type TaggedLink = { slug: string; chapter: number; key: string; link: Link };
export type TaggedMark = { id: string; verseKeys: string[]; quote: string; date: number; color?: string; style: Annotation["style"]; tags?: Record<string, true> };
export type TaggedNave = { normalizedName: string; name: string; date: number; tags: Record<string, true> };
export type TagData = { highlights: TaggedHighlight[]; notes: TaggedNote[]; links: TaggedLink[]; wordAnnotations: TaggedMark[]; naves?: TaggedNave[] };
/** Bible Strong's TagEntityCounts for the kinds we have, and its itemCount (every tagged verse, note, link and mark). */
export type TagCounts = { highlights: number; notes: number; links: number; wordAnnotations: number; naves: number; itemCount: number };

const empty = (): TagData => ({ highlights: [], notes: [], links: [], wordAnnotations: [] });
const chapterOf = (k: string, prefix: string) => { const m = new RegExp(`^${prefix}(.+)_(\\d+)$`).exec(k); return m ? { slug: m[1], chapter: +m[2] } : null; };

/** Every tag's items, by tag id. */
export async function loadTagData(): Promise<Record<string, TagData & { highlightVerses: number }>> {
  const out: Record<string, TagData & { highlightVerses: number }> = {};
  const of = (id: string) => (out[id] ??= { ...empty(), highlightVerses: 0 });
  const keys = await store.keys();
  const byDate = new Map<string, TaggedHighlight>();
  for (const k of keys) {
    if (k.startsWith("bs_nv_")) {
      const item = await json.get<TaggedNave | null>(k, null);
      if (item?.normalizedName && item.name) for (const id of Object.keys(item.tags ?? {})) (of(id).naves ??= []).push(item);
      continue;
    }
    const h = chapterOf(k, "bs_h_");
    if (h) {
      for (const [v, hl] of Object.entries(await json.get<Record<string, Highlight>>(k, {}))) for (const id of Object.keys(hl.tags ?? {})) {
        const at = `${id}:${hl.date}`;
        if (!byDate.has(at)) { const item: TaggedHighlight = { date: hl.date, color: hl.color, tags: hl.tags, verses: [] }; byDate.set(at, item); of(id).highlights.push(item); }
        byDate.get(at)!.verses.push({ ...h, verse: +v });
        of(id).highlightVerses++;
      }
      continue;
    }
    const n = chapterOf(k, "bs_n_");
    if (n) { for (const [key, note] of Object.entries(await json.get<Record<string, Note>>(k, {}))) for (const id of Object.keys(note.tags ?? {})) of(id).notes.push({ ...n, key, note }); continue; }
    const l = chapterOf(k, "bs_l_");
    if (l) for (const [key, link] of Object.entries(await json.get<Record<string, Link>>(k, {}))) for (const id of Object.keys(link.tags ?? {})) of(id).links.push({ ...l, key, link });
  }
  const marks = new Map<string, Annotation[]>();
  for (const a of await allAnnotations().catch(() => [] as Annotation[])) marks.set(markId(a), [...(marks.get(markId(a)) ?? []), a]);
  for (const [id, records] of marks) {
    const tags = new Set(records.flatMap((r) => Object.keys(r.tags ?? {})));
    const first = records[0];
    for (const t of tags) of(t).wordAnnotations.push({ id, verseKeys: records.map((r) => r.verseKey), quote: records.map((r) => r.quote).join(" "), date: Date.parse(first.created) || 0, color: first.color, style: first.style, tags: Object.fromEntries([...tags].map((x) => [x, true as const])) });
  }
  for (const d of Object.values(out)) d.highlights.sort((a, b) => b.date - a.date);
  return out;
}

/**
 * Every highlight and every word mark, for the Highlights screen: a highlight made at one moment
 * over several verses is one (Bible Strong's buildGroupedHighlights), a mark over several verses one.
 */
export async function loadHighlightItems(): Promise<{ highlights: TaggedHighlight[]; wordAnnotations: TaggedMark[] }> {
  const byDate = new Map<number, TaggedHighlight>();
  for (const k of await store.keys()) {
    const h = chapterOf(k, "bs_h_");
    if (!h) continue;
    for (const [v, hl] of Object.entries(await json.get<Record<string, Highlight>>(k, {}))) {
      if (!byDate.has(hl.date)) byDate.set(hl.date, { date: hl.date, color: hl.color, tags: hl.tags, verses: [] });
      byDate.get(hl.date)!.verses.push({ ...h, verse: +v });
    }
  }
  const marks = new Map<string, Annotation[]>();
  for (const a of await allAnnotations().catch(() => [] as Annotation[])) marks.set(markId(a), [...(marks.get(markId(a)) ?? []), a]);
  const wordAnnotations = [...marks].map(([id, records]): TaggedMark => {
    const first = records[0];
    const tags = Object.fromEntries([...new Set(records.flatMap((r) => Object.keys(r.tags ?? {})))].map((t) => [t, true as const]));
    return { id, verseKeys: records.map((r) => r.verseKey), quote: records.map((r) => r.quote).join(" "), date: Date.parse(first.created) || 0, color: first.color, style: first.style, tags };
  });
  return { highlights: [...byDate.values()], wordAnnotations };
}

/** Change or remove (null) each highlighted verse of a highlight, chapter by chapter. */
export async function editHighlight(item: TaggedHighlight, edit: (h: Highlight) => Highlight | null) {
  const byChapter = new Map<string, number[]>();
  for (const v of item.verses) byChapter.set(`bs_h_${v.slug}_${v.chapter}`, [...(byChapter.get(`bs_h_${v.slug}_${v.chapter}`) ?? []), v.verse]);
  for (const [key, verses] of byChapter) {
    const all = await json.get<Record<string, Highlight>>(key, {});
    for (const v of verses) { const h = all[String(v)]; if (!h) continue; const next = edit(h); if (next) all[String(v)] = next; else delete all[String(v)]; }
    json.set(key, all);
  }
}

/** Change or remove (null) every record of a word mark. */
export async function editMark(id: string, edit: (a: Annotation) => Annotation | null) {
  const records = (await allAnnotations()).filter((a) => markId(a) === id);
  const next = records.map((a) => [a, edit(a)] as const);
  await changeAnnotations({ update: next.filter(([, b]) => b).map(([, b]) => b!), remove: next.filter(([, b]) => !b).map(([a]) => a.id) });
}

export function tagCounts(d: (TagData & { highlightVerses: number }) | undefined): TagCounts {
  if (!d) return { highlights: 0, notes: 0, links: 0, wordAnnotations: 0, naves: 0, itemCount: 0 };
  return { highlights: d.highlights.length, notes: d.notes.length, links: d.links.length, wordAnnotations: d.wordAnnotations.length, naves: d.naves?.length ?? 0, itemCount: d.highlightVerses + d.notes.length + d.links.length + d.wordAnnotations.length + (d.naves?.length ?? 0) };
}

/** The reader at a passage, its verses in focus, as a tagged item opens in Bible Strong. */
const readerAt = (slug: string, chapter: number, verses: number[]) => `/read/${slug}/${chapter}${verses.length ? `?v=${compressVerses(verses)}` : ""}`;
function readerAtKeys(verseKeys: string[]): string | null {
  const parsed = verseKeys.map(parseVerseKey).filter((p): p is NonNullable<typeof p> => !!p);
  if (!parsed.length) return null;
  const { slug, chapter } = parsed[0];
  return readerAt(slug, chapter, parsed.filter((p) => p.slug === slug && p.chapter === chapter).map((p) => p.verse));
}

/**
 * One tab per tagged item, in Bible Strong's order (useCreateTabGroupFromTag): highlights, notes,
 * links, then word marks. We have no note page of our own, so a note opens the reader at its verses.
 */
export function tagTabPaths(d: TagData | undefined): string[] {
  if (!d) return [];
  const paths: string[] = [];
  for (const h of d.highlights) { const first = h.verses[0]; if (first) paths.push(readerAt(first.slug, first.chapter, h.verses.filter((v) => v.slug === first.slug && v.chapter === first.chapter).map((v) => v.verse))); }
  for (const n of d.notes) paths.push(readerAt(n.slug, n.chapter, noteVerses(n.key, n.note)));
  for (const l of d.links) paths.push(readerAt(l.slug, l.chapter, l.key.split("/").map(Number)));
  for (const a of d.wordAnnotations) { const p = readerAtKeys(a.verseKeys); if (p) paths.push(p); }
  for (const n of d.naves ?? []) paths.push(`/nave/en/${encodeURIComponent(n.normalizedName)}`);
  return paths;
}

/** Bible Strong's removeTag: the tag goes, and with it its mark on every highlight, note, link and word mark. */
export async function removeTagEverywhere(id: string) {
  // Read first: if the word marks cannot be read, nothing is changed and the tag stays.
  const marked = (await allAnnotations()).filter((a) => a.tags?.[id]);
  for (const k of await store.keys()) {
    if (k.startsWith("bs_nv_")) {
      const item = await json.get<TaggedNave | null>(k, null);
      if (item?.tags?.[id]) { delete item.tags[id]; await json.set(k, item); }
      continue;
    }
    if (!/^bs_[hnl]_/.test(k)) continue;
    const map = await json.get<Record<string, { tags?: Record<string, true> }>>(k, {});
    let changed = false;
    for (const v of Object.values(map)) if (v.tags?.[id]) { delete v.tags[id]; changed = true; }
    if (changed) await json.set(k, map);
  }
  if (marked.length) await changeAnnotations({ update: marked.map((a) => { const tags = { ...a.tags }; delete tags[id]; return { ...a, tags }; }) });
}
