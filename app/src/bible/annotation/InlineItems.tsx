import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import type { VerseRelationItem } from "@/lib/relations";
import { RelationsText } from "@/ui/relations";
import { VerseTags } from "../dom/Verse";
import type { BibleSettings } from "../settings";
import type { Tag } from "../store";
import type { Palette, ThemeName } from "../theme";
import { collectAnnotationTextNodes } from "./annotationDomText";
import type { Mark } from "./marks";

/**
 * Bible Strong's AnnotationInlineItems (BibleDOM/AnnotationInlineItems.tsx): a mark's relations
 * and tags, when they are shown inline, right after its last word, in a span the gestures ignore.
 */
type Target = { id: string; element: HTMLSpanElement };

export function MarkInlineItems({ marks, markItems, tags, settings, palette, theme, contentKey, onOpenRelationItem, onOpenTags, onOpenTag }: {
  marks: Mark[]; markItems: Record<string, VerseRelationItem[]>; tags: Record<string, Tag>;
  settings: BibleSettings; palette: Palette; theme: ThemeName; contentKey: string;
  onOpenRelationItem: (it: VerseRelationItem) => void; onOpenTags: (markId: string) => void; onOpenTag: (tagId: string) => void;
}) {
  const [targets, setTargets] = useState<Target[]>([]);
  const relationsInline = settings.relationsDisplay === "inline", tagsInline = settings.tagsDisplay === "inline";
  const shown = marks.filter((m) => (relationsInline && markItems[m.id]?.length) || (tagsInline && Object.keys(m.tags ?? {}).length));
  const anchorKey = shown.map((m) => { const r = m.records[m.records.length - 1]; return `${m.id}@${r.verseKey}.${r.end}`; }).join(",");
  useEffect(() => {
    const out: Target[] = [];
    for (const m of shown) {
      const last = m.records[m.records.length - 1];
      const verseEl = document.getElementById(`verse-text-${last.verseKey}`); if (!verseEl) continue;
      const { textNodes } = collectAnnotationTextNodes(verseEl);
      const at = textNodes.find((t) => last.end >= t.startOffset && last.end <= t.endOffset); if (!at) continue;
      const element = document.createElement("span");
      element.dataset.annotationInlineItem = m.id; element.dataset.ignoreVerseTouch = "";
      const range = document.createRange(); range.setStart(at.node, last.end - at.startOffset); range.collapse(true); range.insertNode(element);
      out.push({ id: m.id, element });
    }
    setTargets(out);
    // The text moved: the marks are measured again (Bible Strong's layoutChanged).
    requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
    return () => { for (const t of out) { const parent = t.element.parentNode; t.element.remove(); parent?.normalize(); } };
  }, [anchorKey, contentKey, relationsInline, tagsInline]); // eslint-disable-line react-hooks/exhaustive-deps
  return <>{targets.map(({ id, element }) => {
    const m = marks.find((x) => x.id === id); if (!m) return null;
    const items = relationsInline ? markItems[id] ?? [] : [];
    const markTags = tagsInline ? Object.keys(m.tags ?? {}).map((t) => tags[t]).filter(Boolean) : [];
    return createPortal(
      <span data-ignore-verse-touch="">
        {items.length ? <RelationsText items={items} onClick={onOpenRelationItem} /> : null}
        {markTags.length ? <VerseTags tags={markTags} settings={settings} palette={palette} theme={theme} onOpenTags={() => onOpenTags(id)} onOpenTag={onOpenTag} /> : null}
      </span>, element, id);
  })}</>;
}
