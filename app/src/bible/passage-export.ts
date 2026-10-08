import type { Highlight, Link, Note, Tag } from "./store";
import type { Relation } from "@/lib/relations";
import type { Annotation } from "@/studies/storage";

export type ExportOptions = { text: boolean; notes: boolean; links: boolean; relations: boolean; tags: boolean; phrases: boolean };
export type ExportChapter = {
  slug: string; chapter: number; book: string; verses: { verse: number; text: string }[];
  notes: Record<string, Note>; links: Record<string, Link>; highlights: Record<string, Highlight>;
  relations: Relation[]; annotations: Annotation[];
};

/** A plain-text export of the exact scope, with overlapping notes retained and identified. */
export function passageExport(reference: string, chapters: ExportChapter[], options: ExportOptions, tags: Record<string, Tag>) {
  const lines = [`${reference} (KJV)`, ""];
  const seenRelations = new Set<string>();
  for (const c of chapters) {
    const included = new Set(c.verses.map(v => v.verse));
    const keys = new Set(c.verses.map(v => `${c.slug}-${c.chapter}-${v.verse}`));
    const ref = `${c.book} ${c.chapter}`;
    const tagNames = (ids?: Record<string, true>) => Object.keys(ids ?? {}).map(id => tags[id]?.name).filter(Boolean).join(", ");
    const tagged = (ids?: Record<string, true>) => options.tags && tagNames(ids) ? ` [Tags: ${tagNames(ids)}]` : "";
    const section = (label: string, rows: string[]) => { if (rows.length) lines.push(`${ref} · ${label}`, ...rows, ""); };
    const inScope = (key: string) => key.split("/").some(v => included.has(+v));
    const noteRef = (key: string) => `${ref}:${key.replaceAll("/", ",")}${key.split("/").some(v => !included.has(+v)) ? " (also covers verses outside this selection)" : ""}`;
    if (options.text) section("Scripture", c.verses.map(v => `${v.verse}. ${v.text}`));
    if (options.notes) section("Notes", Object.entries(c.notes).filter(([key]) => inScope(key)).map(([key, n]) => `${noteRef(key)} — ${n.title}${tagged(n.tags)}\n${n.description}`));
    if (options.links) section("Links", Object.entries(c.links).filter(([key]) => inScope(key)).map(([key, l]) => `${noteRef(key)} — ${l.title}${tagged(l.tags)}\n${l.url}`));
    if (options.relations) section("Your precepts", c.relations.filter(r => !seenRelations.has(r.id) && r.endpoints.some(e => e.type === "verse" ? e.verseKeys.some(k => keys.has(k)) : e.type === "note" && keys.has(e.verseKey))).map(r => {
      seenRelations.add(r.id);
      const endpoints = r.direction === "backward" ? [...r.endpoints].reverse() : r.endpoints;
      return `${endpoints[0].label} — ${r.type}${r.direction === "none" ? " — " : " → "}${endpoints[1].label}${r.label ? ` (${r.label})` : ""}`;
    }));
    if (options.tags) section("Verse tags", c.verses.filter(v => tagNames(c.highlights[v.verse]?.tags)).map(v => `${ref}:${v.verse} — ${tagNames(c.highlights[v.verse]?.tags)}`));
    if (options.phrases) section("Phrase marks", c.annotations.filter(a => keys.has(a.verseKey)).map(a => `${ref}:${a.verseKey.split("-").at(-1)} — ${a.style}: “${a.quote}”`));
  }
  return lines.join("\n").trim();
}
