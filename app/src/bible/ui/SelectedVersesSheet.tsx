import { useEffect, useRef, useState, type ReactNode } from "react";

import { haptic } from "@/tg/sdk";
import { Feather, type FeatherName } from "../icons";
import type { HighlightType } from "../settings";
import { Sheet } from "./Sheet";

/**
 * SelectedVersesModal: the colour bar, then three groups of actions (Annotate, Study,
 * Share) swiped as pages under a segmented footer with a sliding indicator. Four actions
 * per row, each a 48 px rounded box with a 20 px icon and a 10 px label.
 */
export type ColorItem = { key: string; hex: string; name?: string; type: HighlightType };
export type SelectedVersesSheetProps = {
  open: boolean; onDismiss: () => void;
  colors: ColorItem[]; selectedColor: string | null;
  onAddHighlight: (key: string) => void; onRemoveHighlight: () => void; onAddColor: () => void; onEditColor: (key: string) => void;
  moreThanOne: boolean; hasBookmark: boolean; hasFocus: boolean;
  onNote: () => void; onTag: () => void; onLink: () => void; onRelation: () => void; onBookmark: () => void; onFocus: () => void;
  onDictionary: () => void; onThemes: () => void; onReferences: () => void; onCommentary: () => void;
  onCopy: () => void; onShare: () => void; onExport: () => void; onSelectAll: () => void;
};
const TABS = ["Annotate", "Study", "Share"];
const TAB_KEY = "selectedVersesTabIndex";

export function SelectedVersesSheet(p: SelectedVersesSheetProps) {
  const [tab, setTab] = useState(() => { try { return Number(localStorage.getItem(TAB_KEY) ?? 0) || 0; } catch { return 0; } });
  const goTo = (i: number) => { setTab(i); try { localStorage.setItem(TAB_KEY, String(i)); } catch { /* ignore */ } };
  const [width, setWidth] = useState(360);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!p.open) return; const el = ref.current; if (!el) return; const ro = new ResizeObserver(() => setWidth(el.clientWidth)); ro.observe(el); setWidth(el.clientWidth); return () => ro.disconnect(); }, [p.open]);
  // A horizontal swipe over the footer or the pages moves between tabs.
  const swipe = useRef<{ x: number; t: number } | null>(null);
  const onStart = (x: number) => { swipe.current = { x, t: Date.now() }; };
  const onEnd = (x: number) => { const s = swipe.current; swipe.current = null; if (!s) return; const dx = x - s.x; if (Math.abs(dx) > 40 && Date.now() - s.t < 500) goTo(Math.max(0, Math.min(TABS.length - 1, tab + (dx < 0 ? 1 : -1)))); };

  return (
    <Sheet open={p.open} onClose={p.onDismiss} backdrop={false} label="Selected verses" className="bs-selected">
      <div style={{ overflow: "hidden" }}>
        <ColorCirclesBar colors={p.colors} selected={p.selectedColor} onSelect={(k) => (p.selectedColor === k ? p.onRemoveHighlight() : p.onAddHighlight(k))} onLongPress={p.onEditColor} onAdd={p.onAddColor} />
        <div ref={ref} className="bs-pages" onTouchStart={(e) => onStart(e.touches[0].clientX)} onTouchEnd={(e) => onEnd(e.changedTouches[0].clientX)}>
          <div className="bs-pages__track" style={{ width: width * TABS.length, transform: `translateX(${-tab * width}px)` }}>
            <div className="bs-page" style={{ width }}>
              <ActionsLayout>
                <ActionItem name="file-plus" label="Note" onPress={p.onNote} />
                <ActionItem name="tag" label="Tag" onPress={p.onTag} />
                <ActionItem name="link" label="Link" onPress={p.onLink} />
                <ActionItem name="git-merge" label="Relation" onPress={p.onRelation} />
                <ActionItem name="bookmark" label="Bookmark" onPress={p.onBookmark} disabled={p.moreThanOne} isActive={p.hasBookmark} />
                <ActionItem name="crosshair" label="Focus" onPress={p.onFocus} isActive={p.hasFocus} />
              </ActionsLayout>
            </div>
            <div className="bs-page" style={{ width }}>
              <ActionsLayout>
                <ActionItem icon={<DictionaryIcon />} tint="var(--bs-secondary)" label="Dictionary" onPress={p.onDictionary} disabled={p.moreThanOne} />
                <ActionItem icon={<NaveIcon />} tint="var(--bs-quint)" label="Themes" onPress={p.onThemes} disabled={p.moreThanOne} />
                <ActionItem icon={<ReferencesIcon />} tint="var(--bs-quart)" label="References" onPress={p.onReferences} disabled={p.moreThanOne} />
                <ActionItem icon={<CommentIcon />} tint="#26A69A" label="Commentary" onPress={p.onCommentary} disabled={p.moreThanOne} />
              </ActionsLayout>
            </div>
            <div className="bs-page" style={{ width }}>
              <ActionsLayout>
                <ActionItem name="copy" label="Copy" onPress={p.onCopy} />
                <ActionItem name="share-2" label="Share" onPress={p.onShare} />
                <ActionItem name="download" label="Export" onPress={p.onExport} />
                <ActionItem name="check-square" label="Select all" onPress={p.onSelectAll} />
              </ActionsLayout>
            </div>
          </div>
        </div>
        <div className="bs-tabsfooter" role="tablist" onTouchStart={(e) => onStart(e.touches[0].clientX)} onTouchEnd={(e) => onEnd(e.changedTouches[0].clientX)}>
          <span className="bs-tabsfooter__indicator" style={{ width: `calc((100% - 6px) / ${TABS.length})`, transform: `translateX(${tab * 100}%)` }} />
          {TABS.map((t, i) => <button key={t} type="button" role="tab" aria-selected={tab === i} className="bs-tabsfooter__tab" onClick={() => { haptic("select"); goTo(i); }}>{t}</button>)}
        </div>
      </div>
    </Sheet>
  );
}

export function ActionsLayout({ children }: { children: ReactNode }) { return <div className="bs-actions">{children}</div>; }

export function ActionItem({ name, icon, tint, label, onPress, disabled, isActive, variant = "default" }: { name?: FeatherName; icon?: ReactNode; tint?: string; label: string; onPress: () => void; disabled?: boolean; isActive?: boolean; variant?: "default" | "emphasized" }) {
  const color = variant === "emphasized" ? "var(--bs-reverse)" : tint ?? "var(--bs-primary)";
  return (
    <button type="button" className="bs-action" disabled={disabled} aria-pressed={isActive} data-variant={variant} onClick={() => { haptic("select"); onPress(); }} style={{ opacity: disabled ? 0.6 : 1 }}>
      <span className="bs-action__box" style={{ background: variant === "emphasized" ? "var(--bs-primary)" : "var(--bs-light-grey)", boxShadow: variant === "emphasized" ? "0 2px 8px 0 var(--bs-primary)" : isActive ? "inset 0 0 0 2px var(--bs-primary)" : undefined, color, opacity: disabled ? 0.4 : 1 }}>
        {icon ?? (name ? <Feather name={name} size={20} color={color} /> : null)}
      </span>
      <span className="bs-action__label" style={{ opacity: disabled ? 0.4 : 1 }}>{label}</span>
    </button>
  );
}

/** ColorCirclesBar / ColorCircleGrid: 20 px rounded squares, the current one ringed, then the add arrow. */
export function ColorCirclesBar({ colors, selected, onSelect, onLongPress, onAdd, size = 20 }: { colors: ColorItem[]; selected: string | null; onSelect: (k: string) => void; onLongPress?: (k: string) => void; onAdd?: () => void; size?: number }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);
  const start = (k: string) => { fired.current = false; if (!onLongPress) return; timer.current = setTimeout(() => { fired.current = true; onLongPress(k); }, 500); };
  const end = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  return (
    <div className="bs-colors" role="group" aria-label="Highlight colour">
      {colors.map((c, i) => (
        <button key={c.key} type="button" className="bs-colors__cell" aria-label={c.name || `Color ${i + 1}`} aria-pressed={selected === c.key}
          onPointerDown={() => start(c.key)} onPointerUp={end} onPointerLeave={end} onPointerCancel={end} onContextMenu={(e) => e.preventDefault()}
          onClick={() => { if (fired.current) { fired.current = false; return; } haptic("select"); onSelect(c.key); }}>
          <HighlightTypeIndicator color={c.hex} type={c.type} size={size} isSelected={selected === c.key} />
        </button>
      ))}
      {onAdd ? <button type="button" className="bs-colors__cell" aria-label="Add a color" onClick={onAdd}><Feather name="arrow-right-circle" size={size} color="var(--bs-tertiary)" /></button> : null}
    </div>
  );
}

/** HighlightTypeIndicator: a filled square for a background colour, an "A" for a text colour, an underlined "A". */
export function HighlightTypeIndicator({ color, type, size = 30, isSelected }: { color: string; type: HighlightType; size?: number; isSelected?: boolean }) {
  const ring = isSelected ? "0 0 0 3px var(--bs-reverse), 0 0 0 5px var(--bs-primary)" : undefined;
  if (type === "background") return <span style={{ display: "block", width: size, height: size, borderRadius: size / 3, backgroundColor: color, boxShadow: ring, transition: "box-shadow .3s" }} />;
  const box = { display: "grid", placeItems: "center", position: "relative" as const, width: size, height: size, borderRadius: size / 3, boxShadow: `inset 0 0 2px 0 rgba(0,0,0,.15)${isSelected ? `, 0 0 0 2px var(--bs-reverse), 0 0 0 4px var(--bs-primary)` : ""}` };
  if (type === "textColor") return <span style={box}><b style={{ fontSize: size * 0.85, color, lineHeight: 1 }}>A</b></span>;
  return <span style={box}><b style={{ fontSize: size * 0.85, color: "var(--bs-dark-grey)", opacity: 0.6, lineHeight: 1 }}>A</b><span style={{ position: "absolute", bottom: 0, left: size * 0.15, right: size * 0.15, height: size * 0.2, border: `${size * 0.05}px solid var(--bs-reverse)`, backgroundColor: color, borderRadius: size * 0.3 }} /></span>;
}

const DictionaryIcon = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /><path d="M9 7h6M9 11h4" /></svg>;
const NaveIcon = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18M3 12h18" /></svg>;
const ReferencesIcon = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17 3l4 4-9 9H8v-4z" /><path d="M3 21h18" /><path d="M14 6l4 4" /></svg>;
const CommentIcon = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>;
