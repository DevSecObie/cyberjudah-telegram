import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { haptic, hideKeyboard } from "@/tg/sdk";

import { useModal } from "./modal";
import { Icon } from "./icons";
import { popoverTrigger, usePopover } from "./popover";
import { Button, Sheet } from "@/bible/ui/Sheet";


/**
 * A bottom sheet, the app's own: Telegram's showPopup takes three buttons at most, and a
 * verse has more to offer (highlight colours, a note, copy, share). Opened from anywhere
 * with `useSheet().open(...)`; Telegram's back button closes it first (see useBackButton).
 */
export type SheetItem = { id: string; text: string; icon?: ReactNode; destructive?: boolean; hint?: string };
export type SheetSpec = {
  title?: string;
  items?: SheetItem[];
  /** Highlight colours: the ids are the colour keys. */
  colors?: { id: string; label: string; css: string; on?: boolean }[];
  /** A text field: resolves with `{ id: "text", value }`. */
  text?: { label: string; value?: string; placeholder?: string; submit: string };
};
export type SheetAnswer = { id: string; value?: string } | null;

type Ctx = { open(spec: SheetSpec): Promise<SheetAnswer>; close(): void; isOpen: boolean };
const SheetContext = createContext<Ctx>({ open: async () => null, close: () => {}, isOpen: false });
export const useSheet = () => useContext(SheetContext);

export function SheetProvider({ children }: { children: ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const [spec, setSpec] = useState<SheetSpec | null>(null);
  const resolver = useRef<((a: SheetAnswer) => void) | null>(null);
  const anchor = useRef<HTMLElement | null>(null);
  const [text, setText] = useState("");
  const answer = useCallback((a: SheetAnswer) => { resolver.current?.(a); resolver.current = null; setOpen(false); }, []);
  const open = useCallback((s: SheetSpec) => new Promise<SheetAnswer>((resolve) => { resolver.current?.(null); resolver.current = resolve; anchor.current = popoverTrigger(); setText(s.text?.value ?? ""); setSpec(s); setOpen(true); haptic("select"); }), []);
  const ctx = useMemo(() => ({ open, close: () => answer(null), isOpen }), [open, answer, isOpen]);
  const box = useRef<HTMLDivElement>(null);
  const present = usePopover(isOpen, box);
  const actions = !!spec?.items?.length && !spec.text && !spec.colors;
  // iOS 26: an action menu springs from the control that opened it, on phones too, and the rest
  // of the page stays usable; tapping outside closes it, so it needs no Cancel row.
  const anchored = actions && !!anchor.current?.isConnected;
  useModal(box, isOpen && present && anchored, () => answer(null), { lock: false, trap: false });
  useLayoutEffect(() => {
    const el = box.current, trigger = anchor.current;
    if (!present || !anchored || !el || !trigger) return;
    let frame = 0;
    const place = () => {
      frame = 0;
      const from = trigger.getBoundingClientRect(), bounds = el.parentElement!.getBoundingClientRect();
      const width = el.offsetWidth, height = el.offsetHeight, gap = 8;
      const left = Math.max(gap, Math.min(from.left - bounds.left, bounds.width - width - gap));
      const below = from.bottom - bounds.top + gap;
      const top = below + height <= bounds.height - gap ? below : Math.max(gap, from.top - bounds.top - height - gap);
      el.style.left = `${left}px`; el.style.top = `${Math.min(top, bounds.height - height - gap)}px`;
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(place); };
    place();
    const observer = new ResizeObserver(schedule); observer.observe(el); observer.observe(el.parentElement!); observer.observe(trigger);
    window.addEventListener("scroll", schedule, true); window.addEventListener("resize", schedule);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener("scroll", schedule, true); window.removeEventListener("resize", schedule); el.style.removeProperty("left"); el.style.removeProperty("top"); };
  }, [anchored, present, spec]);
  useEffect(() => {
    if (!isOpen || !anchored) return;
    // Dismiss without consuming the event: the clicked page control still runs its action.
    const outside = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node) && !anchor.current?.contains(e.target as Node)) answer(null); };
    // Wait for click: a snapshot started at pointerdown would cover the pointerup target.
    document.addEventListener("click", outside, true);
    return () => document.removeEventListener("click", outside, true);
  }, [isOpen, anchored, answer]);
  const items = spec?.items?.length ? [...spec.items].sort((x, y) => Number(!!x.destructive) - Number(!!y.destructive)) : [];
  return (
    <SheetContext.Provider value={ctx}>
      {children}
      {present && spec && anchored ? (
        <div className="sheet__scrim" data-anchored="" onClick={(e) => { if (e.target === e.currentTarget) answer(null); }}>
          <div ref={box} className="sheet" data-popover="" data-actions="" inert={!isOpen} aria-hidden={!isOpen} role="dialog" aria-modal={false} aria-label={spec.title ?? "Options"} data-sheet-open="">
            {spec.title ? <p className="sheet__title">{spec.title}</p> : null}
            <div className="sheet__items">
              {items.map((it) => <button key={it.id} type="button" className="sheet__item" data-destructive={it.destructive ? "" : undefined} onClick={() => answer({ id: it.id })}>{it.icon || it.destructive ? <span className="sheet__icon">{it.icon ?? <Icon name="trash" size={18} />}</span> : null}<span><b>{it.text}</b>{it.hint ? <small>{it.hint}</small> : null}</span></button>)}
            </div>
          </div>
        </div>
      ) : null}
      {/* Otherwise Bible Strong's auto sheet: SheetHeader with the title, SheetItem rows (20 px, a
          line under each) and no Cancel: a swipe or a tap outside closes it. A text field is its
          RenameModal: the field in a 20 px box and Save in the footer. */}
      <Sheet open={!!spec && isOpen && !anchored} onClose={() => answer(null)} title={spec?.title} label={spec?.title ?? "Options"} className="action-sheet"
        footer={spec?.text ? <Button onClick={() => { hideKeyboard(); if (text.trim()) answer({ id: "text", value: text.trim() }); }} disabled={!text.trim()}>{spec.text.submit}</Button> : undefined}>
        {spec?.colors ? (
          <div className="sheet__colors" role="group" aria-label="Highlight colour">
            {spec.colors.map((c) => <button key={c.id} type="button" className="swatch" aria-pressed={c.on} aria-label={c.label} title={c.label} style={{ background: c.css }} onClick={() => answer({ id: c.id })} />)}
          </div>
        ) : null}
        {spec?.text ? (
          <form className="action-sheet__form" onSubmit={(e) => { e.preventDefault(); hideKeyboard(); if (text.trim()) answer({ id: "text", value: text.trim() }); }}>
            <input id="sheet-text" aria-label={spec.text.label} value={text} placeholder={spec.text.placeholder ?? spec.text.label} onChange={(e) => setText(e.target.value)} autoFocus maxLength={1500} enterKeyHint="send" />
          </form>
        ) : null}
        {items.map((it) => <button key={it.id} type="button" className="sheet__item action-sheet__item" data-destructive={it.destructive ? "" : undefined} onClick={() => answer({ id: it.id })}><span>{it.text}{it.hint ? <small>{it.hint}</small> : null}</span></button>)}
      </Sheet>
    </SheetContext.Provider>
  );
}
