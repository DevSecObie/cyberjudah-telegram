import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link } from "react-router";

import { compressVerses, data } from "@/api/data";
import { Feather, type FeatherName } from "@/bible/icons";
import { highlightInfo, paletteOf, resolveTheme, telegramScheme, useBibleSettings } from "@/bible/settings";
import { compactVerses, useTags, type Tag } from "@/bible/store";
import { HighlightTypeIndicator } from "@/bible/ui/SelectedVersesSheet";
import type { TagData, TaggedHighlight, TaggedLink, TaggedMark, TaggedNote } from "@/lib/tag-items";
import { parseVerseKey } from "@/lib/relations";
import { haptic } from "@/tg/sdk";
import { timeAgo } from "./tab-groups";

/** Bible Strong's helpers/truncate: cut after `n` characters at the next space, then "...". */
export function truncate(text: string | undefined, n: number) {
  if (!text) return "";
  const cut = text.replace(/(\r\n|\n|\r)/gm, "").replace(new RegExp(`^(.{${n}}[^\\s]*).*`, "i"), "$1").concat("...");
  return cut.length >= text.length ? text : cut;
}

function useBookName() {
  const books = useQuery({ queryKey: ["books"], queryFn: data.books, staleTime: Infinity });
  return (slug: string) => books.data?.find((b) => b.slug === slug)?.book ?? slug;
}
const readerAt = (slug: string, chapter: number, verses: number[]) => `/read/${slug}/${chapter}?v=${compressVerses(verses)}`;

/** Bible Strong's EntityChipList: the item's tags as small accent chips, each opening its tag, then the count of its relations, opening them. */
export function EntityChipList({ tags, relationCount = 0, onRelationPress }: { tags?: Record<string, true>; relationCount?: number; onRelationPress?: () => void }) {
  const [all] = useTags();
  const items = Object.keys(tags ?? {}).map((id) => all[id]).filter((t): t is Tag => !!t);
  const relations = relationCount > 0 && !!onRelationPress;
  if (!items.length && !relations) return null;
  return (
    <span className="tagd-chips">
      {items.map((t) => <Link key={t.id} to={`/tags/${t.id}`} className="tagd-chip" onClick={(e) => { e.stopPropagation(); haptic("select"); }}><Feather name="tag" size={10} /><span>{t.name}</span></Link>)}
      {relations ? <button type="button" className="tagd-chip" onClick={(e) => { e.stopPropagation(); haptic("select"); onRelationPress!(); }}><Feather name="git-merge" size={10} /><span>{relationCount}</span></button> : null}
    </span>
  );
}

/** Bible Strong's highlight item (settings/Verse): the colour, the reference, how long ago, then the verses' text. */
export function HighlightItem({ item, now, options }: { item: TaggedHighlight; now: number; options?: ReactNode }) {
  const [settings] = useBibleSettings();
  const palette = paletteOf(resolveTheme(settings, telegramScheme()), settings);
  const bookName = useBookName();
  const first = item.verses[0];
  const verses = item.verses.filter((v) => v.slug === first.slug && v.chapter === first.chapter).map((v) => v.verse).sort((a, b) => a - b);
  const chapter = useQuery({ queryKey: ["chapter", first.slug, first.chapter], queryFn: () => data.chapter(first.slug, first.chapter), staleTime: Infinity });
  const text = chapter.data ? verses.map((v) => chapter.data.verses.find((x) => x.verse === v)?.text ?? "").join(" ").trim() : "";
  const { hex, type } = highlightInfo(item.color, settings, palette);
  return (
    <div className="tagd-item tagd-item--verse">
      <Link to={readerAt(first.slug, first.chapter, verses)} className="tagd-item__open" onClick={() => haptic("select")}>
        <span className="tagd-item__head">
          <span className="tagd-item__ref"><HighlightTypeIndicator color={hex} type={type} size={15} /><span>{`${bookName(first.slug)} ${first.chapter}:${compactVerses(verses)}`}</span></span>
          <small>{timeAgo(item.date, now)}</small>
        </span>
        <span className="tagd-item__text">{chapter.isPending ? "" : text ? truncate(text.replace(/\n/g, ""), 200) : "Text unavailable in the installed Bibles."}</span>
      </Link>
      <EntityChipList tags={item.tags} />
      {options}
    </div>
  );
}

/** Bible Strong's AnnotationItem: the mark's colour and reference, how long ago, then "...the words...". */
export function AnnotationItem({ item, now, options }: { item: TaggedMark; now: number; options?: ReactNode }) {
  const [settings] = useBibleSettings();
  const palette = paletteOf(resolveTheme(settings, telegramScheme()), settings);
  const bookName = useBookName();
  const p = parseVerseKey(item.verseKeys[0]);
  if (!p) return null;
  const { hex } = item.color ? highlightInfo(item.color, settings, palette) : { hex: "var(--accent)" };
  return (
    <div className="tagd-item tagd-item--verse">
      <Link to={readerAt(p.slug, p.chapter, [p.verse])} className="tagd-item__open" onClick={() => haptic("select")}>
        <span className="tagd-item__head">
          <span className="tagd-item__ref"><HighlightTypeIndicator color={hex} type={item.style === "underline" ? "underline" : "background"} size={15} /><span>{`${bookName(p.slug)} ${p.chapter}:${p.verse}`}</span></span>
          <small>{timeAgo(item.date, now)}</small>
        </span>
        <span className="tagd-item__quote">{`...${item.quote}...`}</span>
      </Link>
      <EntityChipList tags={item.tags} />
      {options}
    </div>
  );
}

/** Bible Strong's NoteItem: "Genesis 1:3 - 5 minutes ago", the title, then the start of the text. */
export function NoteItem({ item, now }: { item: TaggedNote; now: number }) {
  const bookName = useBookName();
  const verses = item.key.split("/").map(Number);
  const title = item.note.title?.trim() ?? "", description = item.note.description?.trim() ?? "";
  return (
    <div className="tagd-item tagd-item--note">
      <Link to={readerAt(item.slug, item.chapter, verses)} className="tagd-item__open" onClick={() => haptic("select")}>
        <small className="tagd-item__meta">{`${bookName(item.slug)} ${item.chapter}:${compactVerses(verses)} - ${timeAgo(item.note.date, now)}`}</small>
        {title ? <b className="tagd-item__title">{title}</b> : null}
        {description && description !== title ? <span className="tagd-item__desc">{truncate(description, 100)}</span> : null}
      </Link>
      <EntityChipList tags={item.note.tags} />
    </div>
  );
}

/** Bible Strong's linkTypeConfig: each kind of link's icon on its colour. */
const LINK_TYPES: Record<string, { icon: FeatherName; color: string; text?: string }> = {
  youtube: { icon: "youtube", color: "#FF0000" }, twitter: { icon: "link", color: "#000000", text: "𝕏" }, instagram: { icon: "instagram", color: "#E4405F" },
  tiktok: { icon: "music", color: "#000000" }, vimeo: { icon: "video", color: "#1AB7EA" }, spotify: { icon: "music", color: "#1DB954" },
  facebook: { icon: "facebook", color: "#1877F2" }, linkedin: { icon: "linkedin", color: "#0A66C2" }, github: { icon: "github", color: "#333333" }, website: { icon: "link", color: "#888888" },
};

/** Bible Strong's LinkItem: the kind's icon, "John 1:4 - 2 days ago", the title, then the address. */
export function LinkItem({ item, now }: { item: TaggedLink; now: number }) {
  const bookName = useBookName();
  const verses = item.key.split("/").map(Number);
  const kind = LINK_TYPES[item.link.linkType] ?? LINK_TYPES.website;
  return (
    <div className="tagd-item tagd-item--link">
      <span className="tagd-link__icon" style={{ background: kind.color }}>{kind.text ? <b>{kind.text}</b> : <Feather name={kind.icon} size={14} color="#fff" />}</span>
      <span className="tagd-link__body">
        <Link to={readerAt(item.slug, item.chapter, verses)} className="tagd-item__open" onClick={() => haptic("select")}>
          <small className="tagd-item__meta">{`${bookName(item.slug)} ${item.chapter}:${compactVerses(verses)} - ${timeAgo(item.link.date, now)}`}</small>
          <span className="tagd-link__title">{truncate(item.link.title || item.link.url, 50)}</span>
          <span className="tagd-link__url">{item.link.url}</span>
        </Link>
        <EntityChipList tags={item.link.tags} />
      </span>
    </div>
  );
}

/** Bible Strong's TagSectionHeader: the kind's icon, its name and count, a chevron that turns over 500 ms. */
function SectionHeader({ id, title, count, open, toggle }: { id: string; title: string; count: number; open: boolean; toggle: (id: string) => void }) {
  const [settings] = useBibleSettings();
  const palette = paletteOf(resolveTheme(settings, telegramScheme()), settings);
  const icon = id === "highlights" ? <Feather name="edit-3" size={18} color={palette.color1} raw /> : id === "notes" ? <Feather name="file-text" size={18} color={palette.color2} /> : <Feather name="link" size={18} color="var(--text-3)" />;
  return (
    <button type="button" className="tagd-section" aria-expanded={open} onClick={() => { haptic("select"); toggle(id); }}>
      <span className="tagd-section__title"><span className="tagd-section__icon">{icon}</span><span>{title}</span><span className="tagd-section__count">{count}</span></span>
      <span className="tagd-section__chevron" data-open={open ? "" : undefined}><Feather name="chevron-down" size={17} /></span>
    </button>
  );
}

/**
 * Bible Strong's TagScreen body (buildTagSections): a section per kind the tag carries, closed
 * until tapped. Highlights and word marks share one section, newest first.
 */
export function TagSections({ d }: { d: TagData | undefined }) {
  const [open, setOpen] = useState<string[]>([]);
  const [now] = useState(() => Date.now());
  const toggle = (id: string) => setOpen((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  if (!d) return null;
  const marks = [...d.highlights.map((h) => ({ kind: "highlight" as const, date: h.date, h })), ...d.wordAnnotations.map((a) => ({ kind: "annotation" as const, date: a.date, a }))].sort((x, y) => y.date - x.date);
  const sections = [
    marks.length ? { id: "highlights", title: "Highlights", count: marks.length, body: () => marks.map((m, i) => m.kind === "highlight" ? <HighlightItem key={`h${i}`} item={m.h} now={now} /> : <AnnotationItem key={m.a.id} item={m.a} now={now} />) } : null,
    d.notes.length ? { id: "notes", title: "Notes", count: d.notes.length, body: () => d.notes.map((n) => <NoteItem key={n.note.id ?? `${n.slug}${n.chapter}${n.key}`} item={n} now={now} />) } : null,
    d.links.length ? { id: "links", title: "Links", count: d.links.length, body: () => d.links.map((l) => <LinkItem key={l.link.id ?? `${l.slug}${l.chapter}${l.key}`} item={l} now={now} />) } : null,
  ].filter((s): s is NonNullable<typeof s> => !!s);
  if (!sections.length) return null;
  return (
    <div className="tagd">
      {sections.map((s) => (
        <section key={s.id}>
          <SectionHeader id={s.id} title={s.title} count={s.count} open={open.includes(s.id)} toggle={toggle} />
          {open.includes(s.id) ? s.body() : null}
        </section>
      ))}
    </div>
  );
}
