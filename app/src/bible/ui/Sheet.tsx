import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from "react";

import { sheetOpened } from "@/tg/hooks";
import { useModal } from "@/ui/modal";

import { Feather } from "../icons";
import "./sheet.css";
import { Button as ControlButton } from "@/ui/Button";

/**
 * Bible Strong's bottom sheet (common/sheet): a handle, an optional header with a centred
 * title, a back arrow or a right control, scrolling content and a footer. `backdrop` false
 * leaves the page tappable behind it, as the selected-verses sheet does. Telegram's back
 * button shows while it is open and closes it first (tg/hooks), and it can always be closed
 * with its ✕ (unless `closable` is false: Bible Strong's selection sheet has none) or by swiping
 * it down by the handle or the title.
 */
export function Sheet({ open, onClose, backdrop = true, height = "auto", title, subTitle, hasBack, onBack, right, left, children, footer, className, label, closable = true, actions = false }: {
  open: boolean; onClose: () => void; backdrop?: boolean; closable?: boolean; height?: "auto" | "half" | "full" | "40"; title?: ReactNode; subTitle?: ReactNode; hasBack?: boolean; onBack?: () => void; right?: ReactNode; left?: ReactNode; children?: ReactNode; footer?: ReactNode; className?: string; label?: string; actions?: boolean;
}) {
  const [drag, setDrag] = useState(0);
  const [tall, setTall] = useState(false);
  const start = useRef<number | null>(null);
  const previousTop = useRef<number | null>(null);
  const dragged = useRef(false);
  useEffect(() => { if (open) return sheetOpened(); }, [open]);
  useEffect(() => { if (!open) { setDrag(0); setTall(false); } }, [open]);
  // Swipe by the handle or the title bar: down follows the finger and closes past 90 px; up
  // opens a shorter sheet to full height.
  const down = (e: RPointerEvent) => { if ((e.target as HTMLElement).closest("button:not(.bs-sheet__resize)")) return; dragged.current = false; start.current = e.clientY; ((e.target as HTMLElement).closest(".bs-sheet__resize") ?? e.currentTarget).setPointerCapture(e.pointerId); };
  const move = (e: RPointerEvent) => { if (start.current !== null) { const dy = e.clientY - start.current; if (Math.abs(dy) > 6) dragged.current = true; setDrag(dy); } };
  const up = (e: RPointerEvent) => { if (start.current === null) return; const dy = e.clientY - start.current; start.current = null; if (Math.abs(dy) > 6) dragged.current = true; if (dy > 90) onClose(); else if (dy < -60 && height !== "full" && !tall) { previousTop.current = box.current?.getBoundingClientRect().top ?? null; setTall(true); } setDrag(0); };
  // A sheet over a dimmed page holds the focus; one that leaves the page usable (no backdrop) does not.
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = box.current, from = previousTop.current;
    previousTop.current = null;
    if (!el || from === null) return;
    // Apply the new size once, then animate only the layer's translation and opacity.
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const animation = el.animate([{ transform: reduced ? "none" : `translateY(${from - el.getBoundingClientRect().top}px)`, opacity: .8 }, { transform: "none", opacity: 1 }], { duration: 220, easing: "cubic-bezier(.2,.8,.2,1)" });
    return () => animation.cancel();
  }, [tall]);
  useModal(box, open, onClose, { lock: backdrop, trap: backdrop });
  if (!open) return null;
  return (
    <div className={`sheet__scrim bs-scrim${backdrop ? "" : " bs-scrim--clear"}`} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} className={`bs-sheet bs-sheet--${tall ? "full" : height}${className ? ` ${className}` : ""}`} role="dialog" aria-modal={backdrop} aria-label={label ?? (typeof title === "string" ? title : "Sheet")} data-sheet-open="" data-actions={actions && !tall && height !== "full" ? "" : undefined}
        style={drag > 0 ? { transform: `translateY(${drag}px)`, transition: "none" } : undefined}>
        <div className="bs-sheet__grab" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { start.current = null; setDrag(0); }}>
          {height === "full" ? <div className="bs-sheet__handle" aria-hidden="true" /> : <button type="button" className="bs-sheet__resize" aria-label={tall ? "Collapse sheet" : "Expand sheet"} title={tall ? "Collapse sheet" : "Expand sheet"} aria-expanded={tall} onClick={e => { if (e.detail && dragged.current) return; previousTop.current = box.current?.getBoundingClientRect().top ?? null; setTall(!tall); }}><span className="bs-sheet__handle" aria-hidden="true" /></button>}
          {title !== undefined ? (
            <div className="bs-sheet__header">
              <div className="bs-sheet__side">{hasBack ? <button type="button" className="bs-iconbtn" aria-label="Back" title="Back" onClick={onBack ?? onClose}><Feather name="arrow-left" size={20} /></button> : left}</div>
              <div className="bs-sheet__titles"><b>{title}</b>{subTitle ? <small>{subTitle}</small> : null}</div>
              <div className="bs-sheet__side bs-sheet__side--right">{right}<button type="button" className="bs-iconbtn bs-sheet__close" aria-label="Close" title="Close" onClick={onClose}><Feather name="x" size={18} /></button></div>
            </div>
          ) : closable ? <button type="button" className="bs-iconbtn bs-sheet__close bs-sheet__close--float" aria-label="Close" title="Close" onClick={onClose}><Feather name="x" size={18} /></button> : null}
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
