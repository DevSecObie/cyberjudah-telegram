import { useEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from "react";

import { sheetOpened } from "@/tg/hooks";
import { useModal } from "@/ui/modal";

import { Feather } from "../icons";
import "./sheet.css";
import { Button as ControlButton } from "@/ui/Button";

/** A detent: a fraction of the tallest a sheet can be, or "auto", its content's height. */
export type SnapPoint = number | "auto";

const LEGACY: Record<"auto" | "half" | "full" | "40", SnapPoint[]> = { auto: ["auto"], half: [0.5], full: [1], "40": [0.4] };

/**
 * Bible Strong's bottom sheet (common/sheet.tsx over TrueSheet, as it is on the iPhone).
 *
 * - Detents: up to three `snapPoints`, `["auto"]` (the content's height) unless given; it opens
 *   at the first. The grabber or the header dragged up goes to the next, down to the one before,
 *   and from the first a long enough pull closes it. Pushing the content up while the sheet is not
 *   at its last detent grows it first (TrueSheet's scrollingExpandsSheet); pulling the content
 *   down from the top of its scroll moves the sheet, as a native sheet does.
 * - The grabber is always there, unless the sheet is not `draggable`; with more than one detent a
 *   tap on it goes to the next (UIKit's grabber).
 * - The page behind is dimmed from the detent `dimFrom` (the first, unless given), and a tap on it
 *   closes the sheet; with `backdrop` false it is never dimmed and stays usable.
 * - `dismissible` false: no swipe, tap or Back closes it. There is no ✕: a Bible Strong sheet
 *   closes by a swipe down, a tap outside, or Telegram's Back.
 * - The header (SheetHeader): 54 px, the title in 16 px bold, left-aligned unless `centerTitle`,
 *   the subtitle 13 px grey under it, a back arrow or `left`, `right`, then `headerChildren` (a
 *   search field), with a line under it. The footer (SheetFooter): 8 px by 20 px, no line.
 * - `background` "reverse" is the page colour (Bible Strong's sheets given a backgroundColor);
 *   otherwise the system's material.
 *
 * `height` is the older way to say the detents ("half" is [0.5], "full" [1], "40" [0.4]).
 */
export function Sheet({ open, onClose, backdrop = true, height, snapPoints, dimFrom = 0, background = "glass", title, subTitle, centerTitle = false, hasBack, onBack, right, left, headerChildren, children, footer, className, label, closable = true, dismissible, draggable = true, actions = false }: {
  open: boolean; onClose: () => void; backdrop?: boolean; height?: "auto" | "half" | "full" | "40"; snapPoints?: SnapPoint[]; dimFrom?: number; background?: "glass" | "reverse";
  title?: ReactNode; subTitle?: ReactNode; centerTitle?: boolean; hasBack?: boolean; onBack?: () => void; right?: ReactNode; left?: ReactNode; headerChildren?: ReactNode;
  children?: ReactNode; footer?: ReactNode; className?: string; label?: string; closable?: boolean; dismissible?: boolean; draggable?: boolean; actions?: boolean;
  /** No longer used: a sheet's detents say whether it grows. */ expandable?: boolean;
  /** No longer used: every sheet moves with its content, as a native one does. */ dragAnywhere?: boolean;
}) {
  const detents = (snapPoints?.length ? snapPoints : LEGACY[height ?? "auto"]).slice(0, 3);
  const canDismiss = dismissible ?? closable;
  const [index, setIndex] = useState(0);
  const [drag, setDrag] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const last = detents.length - 1;
  const detent = detents[Math.min(index, last)];
  const dimmed = backdrop && index >= dimFrom;
  useEffect(() => { if (open) return sheetOpened(); }, [open]);
  useEffect(() => { if (!open) { setDrag(0); setIndex(0); } }, [open]);
  // As vaul's drawer: a sheet does not follow the finger in its first 500 ms, so the touch that
  // opened it, or a finger still resting on it, does not move it.
  const openedAt = useRef(0);
  useEffect(() => { if (open) openedAt.current = performance.now(); }, [open]);
  const settled = () => performance.now() - openedAt.current >= 500;
  // The height eases between detents (sheet.css), the sheet's bottom staying where it is.
  const go = (to: number) => setIndex(to);
  // Where a drag ends: up to the next detent, down to the one before, or closed from the first.
  const release = (dy: number) => {
    setDrag(0);
    if (dy < -60 && index < last) go(index + 1);
    else if (dy > 60 && index > 0) go(index - 1);
    else if (dy > 90 && index === 0 && canDismiss) onClose();
  };
  const start = useRef<number | null>(null);
  const dragged = useRef(false);
  const down = (e: RPointerEvent) => { if (!draggable || (e.target as HTMLElement).closest("button:not(.bs-sheet__grabber), a, input")) return; dragged.current = false; start.current = e.clientY; ((e.target as HTMLElement).closest(".bs-sheet__grabber") ?? e.currentTarget).setPointerCapture(e.pointerId); };
  const move = (e: RPointerEvent) => { if (start.current !== null && settled()) { const dy = e.clientY - start.current; if (Math.abs(dy) > 6) dragged.current = true; setDrag(follow(dy)); } };
  const up = (e: RPointerEvent) => { if (start.current === null) return; const dy = e.clientY - start.current; start.current = null; if (Math.abs(dy) > 6) dragged.current = true; release(dy); };
  // Up follows the finger only while there is a detent to grow into; a sheet at its last one stays put.
  const follow = (dy: number) => (dy < 0 && index >= last ? 0 : dy < 0 ? -Math.sqrt(-dy) * 3 : dy);
  // The content's own drag (touch only, as a native sheet's): pulled down from the top of its
  // scroll it moves the sheet; pushed up before the last detent it grows the sheet. Anything
  // sideways, or inside a field or a slider, stays the content's.
  useEffect(() => {
    const el = box.current; if (!el || !open || !draggable) return;
    let t: { x: number; y: number; on: 0 | 1 | -1; scroller: HTMLElement | null } | null = null;
    const scrollerOf = (n: Element | null): HTMLElement | null => {
      for (let p = n as HTMLElement | null; p && p !== el; p = p.parentElement) { const o = getComputedStyle(p).overflowY; if ((o === "auto" || o === "scroll") && p.scrollHeight > p.clientHeight) return p; }
      return null;
    };
    const onStart = (e: TouchEvent) => {
      const target = e.target as HTMLElement;
      if (e.touches.length !== 1 || target.closest(".bs-sheet__grab, input, textarea, select, [contenteditable], [data-sheet-nodrag]")) { t = null; return; }
      t = { x: e.touches[0].clientX, y: e.touches[0].clientY, on: 0, scroller: scrollerOf(target) };
    };
    const onMove = (e: TouchEvent) => {
      if (!t || !settled()) return;
      const dx = e.touches[0].clientX - t.x, dy = e.touches[0].clientY - t.y;
      if (!t.on) {
        if (Math.abs(dx) > 8 && Math.abs(dx) >= Math.abs(dy)) { t = null; return; }
        if (Math.abs(dy) < 8) return;
        const atTop = !t.scroller || t.scroller.scrollTop <= 0;
        if (dy > 0 && atTop && (index > 0 || canDismiss)) t.on = 1;
        else if (dy < 0 && index < last) t.on = -1;
        else { t = null; return; }
      }
      e.preventDefault();
      setDrag(follow(dy));
    };
    const onEnd = (e: TouchEvent) => {
      if (!t) return;
      const on = t.on, dy = (e.changedTouches[0]?.clientY ?? t.y) - t.y; t = null;
      if (!on) return;
      release(dy);
      // The touch that moved the sheet does not also tap what it started on.
      const swallow = (c: Event) => { c.preventDefault(); c.stopPropagation(); };
      el.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => el.removeEventListener("click", swallow, { capture: true }), 400);
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    const onCancel = () => { t = null; setDrag(0); };
    el.addEventListener("touchcancel", onCancel);
    return () => { el.removeEventListener("touchstart", onStart); el.removeEventListener("touchmove", onMove); el.removeEventListener("touchend", onEnd); el.removeEventListener("touchcancel", onCancel); };
  });
  useModal(box, open, canDismiss ? onClose : undefined, { lock: dimmed, trap: dimmed });
  if (!open) return null;
  const header = title !== undefined || subTitle !== undefined || hasBack || left || right || headerChildren;
  const size = detent === "auto" ? undefined : `calc(${detent} * var(--sheet-max))`;
  return (
    <div className={`sheet__scrim bs-scrim${dimmed ? "" : " bs-scrim--clear"}`} onClick={(e) => { if (e.target === e.currentTarget && canDismiss) onClose(); }}>
      <div ref={box} className={`bs-sheet bs-sheet--${detent === 1 ? "full" : detent === "auto" ? "auto" : detent === 0.5 ? "half" : "part"}${className ? ` ${className}` : ""}`} role="dialog" aria-modal={dimmed} aria-label={label ?? (typeof title === "string" ? title : "Sheet")}
        data-sheet-open="" data-detent={index} data-background={background} data-actions={actions && detent !== 1 ? "" : undefined}
        style={{ height: size, ...(drag ? { transform: `translateY(${drag}px)`, transition: "none" } : null) }}>
        {/* The empty click handler makes the strip a tap target of its own: without one, Android's
            touch adjustment moves a tap here onto the nearest button below (a highlight colour). */}
        <div className="bs-sheet__grab" onClick={() => {}} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { start.current = null; setDrag(0); }}>
          {!draggable ? null : last > 0
            ? <button type="button" className="bs-sheet__grabber" aria-label={index < last ? "Expand sheet" : "Collapse sheet"} title={index < last ? "Expand sheet" : "Collapse sheet"} aria-expanded={index === last} onClick={(e) => { if (e.detail && dragged.current) return; go(index < last ? index + 1 : 0); }}><span className="bs-sheet__handle" aria-hidden="true" /></button>
            : <div className="bs-sheet__grabber" aria-hidden="true"><span className="bs-sheet__handle" /></div>}
          {header ? (
            <div className="bs-sheet__head">
              <div className="bs-sheet__header" data-center={centerTitle ? "" : undefined}>
                {hasBack ? <button type="button" className="bs-sheet__back" aria-label="Back" title="Back" onClick={onBack ?? onClose}><Feather name="arrow-left" size={20} /></button> : left}
                <div className="bs-sheet__titles" data-pad-left={hasBack || left ? undefined : ""} data-pad-right={right ? undefined : ""}>
                  {title !== undefined ? <b role="heading" aria-level={2}>{title}</b> : null}
                  {subTitle ? <small>{subTitle}</small> : null}
                </div>
                {right}
              </div>
              {headerChildren}
            </div>
          ) : null}
        </div>
        <div className="bs-sheet__body">{children}</div>
        {footer ? <div className="bs-sheet__footer">{footer}</div> : null}
      </div>
    </div>
  );
}

/** Bible Strong's `Button`: primary fill, or `reverse` (outlined) for a secondary action. */
export function Button({ children, onClick, reverse, disabled, small }: { children: ReactNode; onClick: () => void; reverse?: boolean; disabled?: boolean; small?: boolean }) {
  return <ControlButton className="bs-btn" appearance={reverse ? "bordered" : "prominent"} size={small ? "sm" : "md"} disabled={disabled} onClick={onClick}>{children}</ControlButton>;
}

/** Bible Strong's `Switch` on the web: a 36×22 track with a white thumb. */
export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} title={label} className="bs-switchrow" onClick={() => onChange(!on)}>
      <span className="bs-switchrow__label">{label}</span>
      <span className="bs-switch" data-on={on ? "" : undefined}><span /></span>
    </button>
  );
}

export function Checkbox({ checked }: { checked: boolean }) {
  return <span className="bs-checkbox" data-checked={checked ? "" : undefined} aria-hidden="true">{checked ? <Feather name="check" size={14} color="var(--bs-reverse)" /> : null}</span>;
}
