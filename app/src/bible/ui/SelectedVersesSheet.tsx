import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { haptic } from "@/tg/sdk";
import { Feather, type FeatherName } from "../icons";
import type { HighlightType } from "../settings";
import { Sheet } from "./Sheet";
import { ResourceIcon } from "./ResourceIcon";

/**
 * SelectedVersesModal, at Bible Strong's sizes: the grabber, the colour bar (60 px rows, 20 px
 * swatches spread evenly, the circled arrow opening the colour palette), then three groups of
 * actions (Annotate, Study, Share) in rows of 70 px items that scroll sideways (a 48 px tile, a
 * 20 px icon, a 10 px label), swiped as pages under the segmented footer. No title and no close,
 * as in Bible Strong: the header already names the passage. It is as tall as its content and
 * never expands; it closes by dragging it down from anywhere on it, Telegram's back button or
 * Escape, and closing it lets go of the selection.
 */
export type ColorItem = { key: string; hex: string; name?: string; type: HighlightType };
export type SelectedVersesSheetProps = {
  open: boolean; onDismiss: () => void;
  /** The selected passage as the header names it (Psalms 23:1-4). */
  reference?: string;
  colors: ColorItem[]; selectedColor: string | null;
  onAddHighlight: (key: string) => void; onRemoveHighlight: () => void; onAddColor: () => void; onEditColor: (key: string) => void;
  moreThanOne: boolean; hasBookmark: boolean; hasFocus: boolean;
  /** Free mode (annotation mode), the last Annotate action. */
  onFreeMode: () => void;
  onNote: () => void; onTag: () => void; onLink: () => void; onRelation: () => void; onBookmark: () => void; onFocus: () => void;
  onLexicon: () => void; onDictionary: () => void; onThemes: () => void; onReferences: () => void; onCommentary: () => void; onCompare: () => void;
  onStudy: () => void;
  onCopy: () => void; onShare: () => void; onExport: () => void; onSelectAll: () => void;
};
const TABS = ["Annotate", "Study", "Share"];
const TAB_KEY = "selectedVersesTabIndex";

export function SelectedVersesSheet(p: SelectedVersesSheetProps) {
  const [tab, setTab] = useState(() => { try { const saved = Number(localStorage.getItem(TAB_KEY)); return Number.isInteger(saved) && saved >= 0 && saved < TABS.length ? saved : 0; } catch { return 0; } });
  const goTo = (i: number) => { setTab(i); try { localStorage.setItem(TAB_KEY, String(i)); } catch { /* ignore */ } };
  const [width, setWidth] = useState(360);
  const ref = useRef<HTMLDivElement>(null);
  // The sheet covers the app's dock: while it is open the dock is out of reach for the keyboard and
  // screen readers too (Tab would otherwise land on buttons hidden under the sheet).
  useEffect(() => {
    if (!p.open) return;
    const dock = document.querySelector<HTMLElement>("nav.tabs");
    if (!dock || dock.inert) return;
    dock.inert = true;
    return () => { dock.inert = false; };
  }, [p.open]);
  // Measured before the first paint, so the pages open at their width instead of sliding into it.
  useLayoutEffect(() => { if (!p.open) return; const el = ref.current; if (!el) return; const ro = new ResizeObserver(() => setWidth(el.clientWidth)); ro.observe(el); setWidth(el.clientWidth); return () => ro.disconnect(); }, [p.open]);
  // A horizontal swipe over the footer or the pages moves between tabs.
  const swipe = useRef<{ x: number; t: number; first?: boolean; last?: boolean } | null>(null);
  const onStart = (x: number, row?: Element | null) => {
    const r = row instanceof HTMLElement && row.scrollWidth > row.clientWidth + 1 ? row : null;
    swipe.current = { x, t: Date.now(), first: !r || r.scrollLeft <= 1, last: !r || r.scrollLeft + r.clientWidth >= r.scrollWidth - 2 };
  };
  // Over a row of actions that scrolls, the swipe scrolls it; it turns the page only when the row was already at that end.
  const onEnd = (x: number) => {
    const s = swipe.current; swipe.current = null; if (!s) return; const dx = x - s.x;
    if (Math.abs(dx) <= 40 || Date.now() - s.t >= 500 || (dx < 0 ? !s.last : !s.first)) return;
    goTo(Math.max(0, Math.min(TABS.length - 1, tab + (dx < 0 ? 1 : -1))));
  };

  return (
    <Sheet open={p.open} onClose={p.onDismiss} backdrop={false} actions label={p.reference ? `Selected: ${p.reference}` : "Selected verses"} className="bs-selected">
      <div className="bs-selected__inner">
        <ColorCirclesBar colors={p.colors} selected={p.selectedColor} onSelect={(k) => (p.selectedColor === k ? p.onRemoveHighlight() : p.onAddHighlight(k))} onLongPress={p.onEditColor} onAdd={p.onAddColor} />
        <div ref={ref} className="bs-pages" onTouchStart={(e) => onStart(e.touches[0].clientX, (e.target as Element).closest(".bs-actions"))} onTouchEnd={(e) => onEnd(e.changedTouches[0].clientX)}>
          <div className="bs-pages__track" style={{ width: width * TABS.length, transform: `translateX(${-tab * width}px)` }}>
            <div className="bs-page" style={{ width }} role="tabpanel" id={`sv-panel-0`} aria-labelledby={`sv-tab-0`} aria-hidden={tab !== 0} inert={tab !== 0}>
              <ActionsLayout>
                <ActionItem name="file-plus" label="Note" onPress={p.onNote} />
                <ActionItem name="tag" label="Tag" onPress={p.onTag} />
                <ActionItem name="link" label="Link" onPress={p.onLink} />
                <ActionItem name="git-merge" label="Relation" onPress={p.onRelation} />
                <ActionItem name="bookmark" label="Bookmark" onPress={p.onBookmark} disabled={p.moreThanOne} isActive={p.hasBookmark} />
                <ActionItem name="feather" label="To study" onPress={p.onStudy} />
                <ActionItem name="crosshair" label="Focus" onPress={p.onFocus} isActive={p.hasFocus} />
                <ActionItem name="edit-2" label="Free mode" onPress={p.onFreeMode} variant="emphasized" />
              </ActionsLayout>
            </div>
            <div className="bs-page" style={{ width }} role="tabpanel" id={`sv-panel-1`} aria-labelledby={`sv-tab-1`} aria-hidden={tab !== 1} inert={tab !== 1}>
              <ActionsLayout>
                <ActionItem icon={<LexiconIcon />} tint="var(--bs-primary)" label="Lexicon" onPress={p.onLexicon} disabled={p.moreThanOne} />
                <ActionItem icon={<DictionaryIcon />} tint="var(--bs-secondary)" label="Dictionary" onPress={p.onDictionary} disabled={p.moreThanOne} />
                <ActionItem icon={<NaveIcon />} tint="var(--bs-quint)" label="Themes" onPress={p.onThemes} disabled={p.moreThanOne} />
                <ActionItem icon={<ReferencesIcon />} tint="var(--bs-quart)" label="References" onPress={p.onReferences} disabled={p.moreThanOne} />
                <ActionItem icon={<CommentIcon />} tint="#26A69A" label="Commentary" onPress={p.onCommentary} disabled={p.moreThanOne} />
                <ActionItem name="layers" label="Compare" onPress={p.onCompare} />
              </ActionsLayout>
            </div>
            <div className="bs-page" style={{ width }} role="tabpanel" id={`sv-panel-2`} aria-labelledby={`sv-tab-2`} aria-hidden={tab !== 2} inert={tab !== 2}>
              <ActionsLayout>
                <ActionItem name="copy" label="Copy" onPress={p.onCopy} />
                <ActionItem name="share-2" label="Share" onPress={p.onShare} />
                <ActionItem name="download" label="Export" onPress={p.onExport} />
                <ActionItem name="check-square" label="Select all" onPress={p.onSelectAll} />
              </ActionsLayout>
            </div>
          </div>
        </div>
        <div className="bs-tabsfooter" role="tablist" aria-label="Actions" onTouchStart={(e) => onStart(e.touches[0].clientX)} onTouchEnd={(e) => onEnd(e.changedTouches[0].clientX)}>
          <span className="bs-tabsfooter__indicator" style={{ width: `calc((100% - 6px) / ${TABS.length})`, transform: `translateX(${tab * 100}%)` }} />
          {TABS.map((t, i) => <button key={t} type="button" role="tab" id={`sv-tab-${i}`} aria-controls={`sv-panel-${i}`} aria-selected={tab === i} tabIndex={tab === i ? 0 : -1} className="bs-tabsfooter__tab"
            onClick={() => { haptic("select"); goTo(i); }}
            onKeyDown={(e) => { const n = e.key === "ArrowRight" ? (tab + 1) % TABS.length : e.key === "ArrowLeft" ? (tab - 1 + TABS.length) % TABS.length : e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : -1; if (n < 0) return; e.preventDefault(); goTo(n); (e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role=tab]")[n])?.focus(); }}>{t}</button>)}
        </div>
      </div>
    </Sheet>
  );
}

export function ActionsLayout({ children }: { children: ReactNode }) { return <div className="bs-actions">{children}</div>; }

export function ActionItem({ name, icon, tint, label, onPress, disabled, isActive, variant = "default" }: { name?: FeatherName; icon?: ReactNode; tint?: string; label: string; onPress: () => void; disabled?: boolean; isActive?: boolean; variant?: "default" | "emphasized" }) {
  const color = variant === "emphasized" ? "var(--bs-reverse)" : tint ?? "var(--sel-accent, var(--bs-primary))";
  return (
    <button type="button" className="bs-action" disabled={disabled} aria-pressed={isActive} data-variant={variant} onClick={() => { haptic("select"); onPress(); }}>
      <span className="bs-action__box" data-active={isActive ? "" : undefined} style={{ color }}>
        {icon ?? (name ? <Feather name={name} size={20} color={color} raw /> : null)}
      </span>
      <span className="bs-action__label">{label}</span>
    </button>
  );
}

/**
 * ColorCirclesBar / ColorCircleGrid: 20 px swatches in 60 px cells spread across the row (40 px at
 * least), the current one ringed (HighlightTypeIndicator), then the circled arrow to the palette.
 * A long press on a colour edits it.
 */
export function ColorCirclesBar({ colors, selected, onSelect, onLongPress, onAdd, size = 20 }: { colors: ColorItem[]; selected: string | null; onSelect: (k: string) => void; onLongPress?: (k: string) => void; onAdd?: () => void; size?: number }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);
  const start = (k: string) => { fired.current = false; if (!onLongPress) return; timer.current = setTimeout(() => { fired.current = true; onLongPress(k); }, 500); };
  const end = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  return (
    <div className="bs-colors" role="group" aria-label="Highlight colour">
      {colors.map((c, i) => (
        <button key={c.key} type="button" className="bs-colors__cell" aria-label={`Highlight ${c.name || colourName(c.hex) || i + 1}${c.type === "textColor" ? " text" : c.type === "underline" ? " underline" : ""}`} title={`Highlight ${c.name || colourName(c.hex) || i + 1}${c.type === "textColor" ? " text" : c.type === "underline" ? " underline" : ""}`} aria-pressed={selected === c.key}
          onPointerDown={() => start(c.key)} onPointerUp={end} onPointerLeave={end} onPointerCancel={end} onContextMenu={(e) => e.preventDefault()}
          onClick={() => { if (fired.current) { fired.current = false; return; } haptic("select"); onSelect(c.key); }}>
          <span className="bs-colors__swatch" data-on={selected === c.key ? "" : undefined}>
            <HighlightTypeIndicator color={c.hex} type={c.type} size={size} isSelected={selected === c.key} />
          </span>
        </button>
      ))}
      {onAdd ? <button type="button" className="bs-colors__cell" aria-label="Add a color" title="Add a color" onClick={onAdd}><span className="bs-colors__swatch bs-colors__more"><Feather name="arrow-right-circle" size={size} color="var(--bs-tertiary)" /></span></button> : null}
    </div>
  );
}

/** A plain name for a highlight colour from its hue, for screen readers when it has none of its own. */
export function colourName(hex: string): string {
  const m = hex.replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  if (!m) return "";
  const [r, g, b] = m.slice(1).map((x) => parseInt(x, 16) / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d < 0.08) return mx > 0.8 ? "white" : mx < 0.2 ? "black" : "grey";
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return h < 15 || h >= 345 ? "red" : h < 35 ? "orange" : h < 65 ? "yellow" : h < 160 ? "green" : h < 195 ? "turquoise" : h < 250 ? "blue" : h < 290 ? "purple" : "pink";
}

/** HighlightTypeIndicator: a filled square for a background colour, an "A" for a text colour, an underlined "A". */
export function HighlightTypeIndicator({ color, type, size = 30, isSelected }: { color: string; type: HighlightType; size?: number; isSelected?: boolean }) {
  const ring = isSelected ? "0 0 0 3px var(--bs-reverse), 0 0 0 5px var(--bs-primary)" : undefined;
  if (type === "background") return <span style={{ display: "block", width: size, height: size, borderRadius: size / 3, backgroundColor: color, boxShadow: ring }} />;
  const box = { display: "grid", placeItems: "center", position: "relative" as const, width: size, height: size, borderRadius: size / 3, boxShadow: `inset 0 0 2px 0 rgba(0,0,0,.15)${isSelected ? `, 0 0 0 2px var(--bs-reverse), 0 0 0 4px var(--bs-primary)` : ""}` };
  if (type === "textColor") return <span style={box}><b style={{ fontSize: size * 0.85, color, lineHeight: 1 }}>A</b></span>;
  return <span style={box}><b style={{ fontSize: size * 0.85, color: "var(--bs-dark-grey)", opacity: 0.6, lineHeight: 1 }}>A</b><span style={{ position: "absolute", bottom: 0, left: size * 0.15, right: size * 0.15, height: size * 0.2, border: `${size * 0.05}px solid var(--bs-reverse)`, backgroundColor: color, borderRadius: size * 0.3 }} /></span>;
}

/** The study tiles' icons: our resource icons, in the tile's tint as Bible Strong's tintColor does. */
const LexiconIcon = () => <ResourceIcon kind="strong" size={20} />;
const DictionaryIcon = () => <ResourceIcon kind="dictionary" size={20} />;
const NaveIcon = () => <ResourceIcon kind="nave" size={20} />;
const ReferencesIcon = () => <ResourceIcon kind="references" size={20} />;
const CommentIcon = () => <ResourceIcon kind="commentary" size={20} />;
