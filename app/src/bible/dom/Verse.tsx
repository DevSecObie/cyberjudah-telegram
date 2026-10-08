import { AnnotatedText } from "@/studies/AnnotatedText";
import { useState, type CSSProperties } from "react";

import type { ClassMoment } from "@/api/data";
import type { VerseRelationItem } from "@/lib/relations";
import { RelationsText } from "@/ui/relations";
import { MediaDeck } from "./MediaDeck";
import { Feather, Ion } from "../icons";
import { contrastText, convertHex, HIGHLIGHT_BACKGROUND_OPACITY, isDarkTheme, type Palette, type ThemeName } from "../theme";
import { highlightInfo, webFontFamily, type BibleSettings } from "../settings";
import { getBibleTextFontSize, scaleFontSize, scaleLineHeight } from "../typography";
import type { Bookmark, Tag } from "../store";

/**
 * One verse, as Bible Strong's BibleDOM/Verse.tsx draws it: the number, a bookmark ribbon,
 * the count badges (precepts, tags) in "With icon" mode, the text and the deck of the classes
 * that taught it, then the tag chip and the precept tags in "Line break" mode. Styles are the
 * same values, on inline style.
 */
export type VerseTagGroup = { tags: Tag[] };
export type VerseProps = {
  verseKey: string; number: number; text: string;
  settings: BibleSettings; palette: Palette; theme: ThemeName;
  isSelected: boolean; isSelectedMode: boolean; isTouched: boolean;
  highlightedColor?: string; bookmark?: Bookmark;
  isVerseToScroll: boolean; isFocused?: boolean; fadePosition?: "top" | "bottom";
  relationItems?: VerseRelationItem[]; relationCount?: number;
  tagGroup?: VerseTagGroup; taggedItemsCount?: number;
  /** The classes that taught this verse, shown as pictures after it. */
  /** The classes that taught this verse, and where the deck's gallery says they are and comes back to. */
  moments?: ClassMoment[]; deck?: { reference: string; from: string };
  onOpenBookmark: (b: Bookmark) => void; onOpenRelations: () => void; onOpenRelationItem: (it: VerseRelationItem) => void; onOpenTags: () => void; onOpenTag: (tagId: string) => void;
};

export function Verse(p: VerseProps) {
  const { settings: s, palette: c, theme } = p;
  const font = webFontFamily(s.fontFamily);
  const block = s.textDisplay === "block";
  // Keep context readable with semantic ink; selection also has a dashed underline.
  let hl: CSSProperties = { background: "transparent", borderRadius: 0 };
  if (p.highlightedColor) {
    const { hex, type } = highlightInfo(p.highlightedColor, s, c);
    if (hex !== "transparent") {
      if (type === "background") hl = { background: convertHex(hex, HIGHLIGHT_BACKGROUND_OPACITY), borderRadius: 4, color: contrastText(hex, isDarkTheme(theme)) };
      else if (type === "textColor") hl = { background: "transparent", borderRadius: 0, color: hex };
      else hl = { background: `linear-gradient(to top, ${convertHex(hex, 60)} 12%, transparent 12%)`, borderRadius: 0 };
    }
  }
  const wrapper: CSSProperties = {
    display: block ? "block" : "inline", transition: "opacity 0.3s ease", position: "relative", zIndex: 1,
    ...(block ? { marginBottom: 5 } : {}),
    ...(p.isSelectedMode && !p.isSelected ? { color: "var(--bs-tertiary)" } : {}),
    ...(p.fadePosition ? { pointerEvents: "none", filter: "blur(4px)" } : {}),
  };
  const container: CSSProperties = {
    fontFamily: font, ...(p.isFocused === false && !p.isSelectedMode ? { color: "var(--bs-tertiary)" } : {}), ...hl, padding: 4, WebkitBoxDecorationBreak: "clone", boxDecorationBreak: "clone",
    borderBottom: p.isSelected ? `2px dashed var(--bs-default)` : "none", userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none",
    ...(p.isVerseToScroll ? { animation: "bs-zoom 0.5s ease 0s 3 normal none running" } : {}),
    ...(p.isTouched ? { backgroundColor: "var(--bs-light-grey)" } : {}),
  };
  const deck = !!(p.moments?.length && p.deck);
  const tags = !!(p.tagGroup?.tags.length && s.tagsDisplay === "inline");
  const rels = !!(p.relationItems?.length && s.relationsDisplay === "inline");
  return (
    <span id={`verset-${p.number}`} className="bs-verse" data-vk={p.verseKey} data-selected={p.isSelected ? "" : undefined} style={wrapper}>
      <span style={container}>
        <span className={s.showVerseNumbers ? "bs-num" : "sr-only"} style={s.showVerseNumbers ? { fontSize: scaleFontSize(14, s.fontSizeScale) } : undefined}>{p.number} </span>
        {p.bookmark ? <BookmarkIcon color={p.bookmark.color} onClick={() => p.onOpenBookmark(p.bookmark!)} /> : null}
        {p.relationCount && s.relationsDisplay !== "inline" ? <CountBadge palette={c} theme={theme} count={p.relationCount} onClick={p.onOpenRelations} label={`${p.relationCount} ${p.relationCount === 1 ? "precept" : "precepts"}`}><Feather name="precepts" size={16} color={"var(--bs-primary)"} /></CountBadge> : null}
        {p.taggedItemsCount && s.tagsDisplay !== "inline" ? <CountBadge palette={c} theme={theme} count={p.taggedItemsCount} onClick={p.onOpenTags} label={`${p.taggedItemsCount} tags`}><Feather name="tag" size={14} color={"var(--bs-primary)"} /></CountBadge> : null}
        <span className="bs-text" data-verse-key={p.verseKey} style={{ fontSize: getBibleTextFontSize(false, s.fontSizeScale), lineHeight: scaleLineHeight(32, s.lineHeight, s.fontSizeScale), whiteSpace: "pre-line" }}><AnnotatedText verseKey={p.verseKey} text={p.text} /></span>
        {deck ? <MediaDeck items={p.moments!} placement="inline" palette={c} fontScale={s.fontSizeScale} reference={p.deck!.reference} from={`${p.deck!.from}?v=${p.number}`} disabled={p.isSelectedMode} /> : null}
      </span>
      {tags ? <VerseTags tags={p.tagGroup!.tags} settings={s} palette={c} theme={theme} onOpenTags={p.onOpenTags} onOpenTag={p.onOpenTag} /> : null}
      {rels ? <span data-ignore-verse-touch=""><RelationsText items={p.relationItems!} onClick={p.onOpenRelationItem} /></span> : null}
    </span>
  );
}

/** BookmarkIcon: an 18px filled ribbon in the bookmark's colour, before the text. */
function BookmarkIcon({ color, onClick }: { color: string; onClick: () => void }) {
  return (
    <span data-ignore-verse-touch="" role="button" tabIndex={0} aria-label="Bookmark" className="bs-bm" style={{ position: "relative", display: "inline-block", transform: "translateY(5px)", marginRight: 8, cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); onClick(); }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill={color} stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>
    </span>
  );
}

/** RelationsCount / TagsIndicator: a shadowed pill with the icon and a 12px grey count badge. */
function CountBadge({ theme, count, onClick, label, children }: { palette: Palette; theme: ThemeName; count: number; onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <span data-ignore-verse-touch="" role="button" tabIndex={0} aria-label={label} className="bs-badge" onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{ backgroundColor: "var(--bs-reverse)", boxShadow: isDarkTheme(theme) ? "0 0 10px 0 rgba(255, 255, 255, 0.1)" : "0 0 10px 0 rgba(0, 0, 0, 0.2)", borderRadius: 8, padding: "4px 8px 4px 8px", wordBreak: "break-word", marginRight: 4, marginLeft: 4, position: "relative", display: "inline-block", cursor: "pointer" }}>
      {children}
      <span style={{ background: "var(--bs-grey)", position: "absolute", width: 12, height: 12, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "arial", fontSize: 10, color: "var(--bs-reverse)", bottom: 0, right: 0 }}>{count}</span>
    </span>
  );
}

/** VerseTags: the chip under the last verse of a highlight, a tag icon, the first tag, "+N". */
function VerseTags({ tags, settings: s, theme, onOpenTags, onOpenTag }: { tags: Tag[]; settings: BibleSettings; palette: Palette; theme: ThemeName; onOpenTags: () => void; onOpenTag: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  if (!tags.length) return null;
  const limit = 1, more = tags.length > limit, shown = expanded ? tags : tags.slice(0, limit);
  const font = webFontFamily(s.fontFamily);
  const small: CSSProperties = { fontFamily: font, padding: "0px 4px", borderRadius: 4, color: "var(--bs-default)", backgroundColor: "var(--bs-light-grey)", fontSize: scaleFontSize(12, s.fontSizeScale), cursor: "pointer", display: "inline-flex", userSelect: "none" };
  return (
    <span data-ignore-verse-touch="" className="bs-inline-item" style={{ fontFamily: font, userSelect: "none", color: "var(--bs-default)", fontSize: scaleFontSize(16, s.fontSizeScale), lineHeight: scaleFontSize(26, s.fontSizeScale), backgroundColor: "var(--bs-reverse)", boxShadow: isDarkTheme(theme) ? "0 0 10px 0 rgba(255, 255, 255, 0.1)" : "0 0 10px 0 rgba(0, 0, 0, 0.2)", borderRadius: 8, paddingInlineEnd: 8, paddingInlineStart: 4, paddingBlock: 4, wordBreak: "break-word", marginInline: 4 }}>
      <span role="button" tabIndex={0} aria-label="Edit tags" style={{ borderInlineEnd: "1px solid rgba(0, 0, 0, 0.2)", paddingInline: 4, marginInlineEnd: 6, cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); onOpenTags(); }}><Feather name="tag" size={Math.round(14 + s.fontSizeScale * 1.4)} color={"var(--bs-primary)"} /></span>
      {shown.map((t) => <span key={t.id} role="button" tabIndex={0} style={{ fontFamily: font, padding: "0px 4px", borderRadius: 4, color: "var(--bs-default)", backgroundColor: "var(--bs-light-grey)", fontSize: scaleFontSize(16, s.fontSizeScale), marginRight: 5, cursor: "pointer", userSelect: "none" }} onClick={(e) => { e.stopPropagation(); onOpenTag(t.id); }}>{t.name}</span>)}
      {!expanded && more ? <span role="button" tabIndex={0} style={{ ...small, marginLeft: 5 }} onClick={(e) => { e.stopPropagation(); setExpanded(true); }}>+{tags.length - limit}</span> : null}
      {expanded && more ? <span role="button" tabIndex={0} aria-label="Collapse" style={{ ...small, padding: "2px 4px" }} onClick={(e) => { e.stopPropagation(); setExpanded(false); }}><Feather name="chevron-left" size={Math.round(14 + s.fontSizeScale * 1.4)} color={"var(--bs-default)"} /></span> : null}
    </span>
  );
}

export { Ion };
