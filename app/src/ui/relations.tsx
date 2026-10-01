import { useState, type ReactNode } from "react";

import { truncate, type Endpoint, type VerseRelationItem } from "@/lib/relations";
import { haptic } from "@/tg/sdk";
import { Icon } from "./ui";

/** Bible Strong's per-type colours and icons (verse: book-open, note: document, link: link, dictionary: book). */
export const TARGET_COLOR: Record<Endpoint["type"], string> = { verse: "var(--accent)", note: "#ff9f1c", entry: "#a78bfa", dictionary: "#3ddc84", link: "#ff2d78" };
export function TargetIcon({ type, size = 15 }: { type: Endpoint["type"]; size?: number }) {
  const name = ({ verse: "book", note: "note", entry: "play", dictionary: "book", link: "link" } as const)[type];
  return <span style={{ color: TARGET_COLOR[type], display: "inline-flex" }}><Icon name={name} size={size} /></span>;
}

/**
 * The relations under a verse, inline ("Line break"): a pill container with a tag per relation
 * (icon of the target's kind + its label, cut at 40 characters), the first three shown, "+N"
 * to expand and a chevron to collapse. Tapping a tag opens the target.
 */
export function RelationsText({ items, onClick }: { items: VerseRelationItem[]; onClick: (item: VerseRelationItem) => void }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, 3);
  const hidden = items.length - visible.length;
  return (
    <span className="rel-inline">
      {visible.map((it) => (
        <button key={it.key} type="button" className="rel-tag" onClick={(e) => { e.stopPropagation(); haptic("select"); onClick(it); }}>
          <TargetIcon type={it.target.type} /><span className="rel-tag__label">{truncate(it.label, 40)}</span>
        </button>
      ))}
      {hidden > 0 ? <button type="button" className="rel-more" onClick={(e) => { e.stopPropagation(); setExpanded(true); }}>+{hidden}</button> : null}
      {expanded && items.length > 3 ? <button type="button" className="rel-more" aria-label="Collapse" onClick={(e) => { e.stopPropagation(); setExpanded(false); }}><Icon name="back" size={12} /></button> : null}
    </span>
  );
}

/** The badge mode ("With icon"): a git-merge icon with the count, beside the verse number. */
export function RelationsCount({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button type="button" className="rel-count" aria-label={`${count} relations`} onClick={(e) => { e.stopPropagation(); haptic("select"); onClick(); }}>
      <MergeIcon /><i>{count}</i>
    </button>
  );
}

export function MergeIcon({ size = 16 }: { size?: number }): ReactNode {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="18" cy="18" r="3" /><circle cx="6" cy="6" r="3" /><path d="M6 21V9a9 9 0 0 0 9 9" /></svg>;
}
