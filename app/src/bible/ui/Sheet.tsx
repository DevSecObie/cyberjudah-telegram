import { useEffect, useRef, useState, type KeyboardEvent as RKeyboardEvent, type PointerEvent as RPointerEvent, type ReactNode } from "react";

import { sheetOpened } from "@/tg/hooks";
import { useDetents, useWide } from "@/ui/detents";
import { useModal } from "@/ui/modal";

import { Feather } from "../icons";
import "./sheet.css";

/**
 * Bible Strong's bottom sheet (common/sheet): a handle, an optional header with a centred
 * title, a back arrow or a right control, scrolling content and a footer. `backdrop` false
 * leaves the page tappable behind it, as the selected-verses sheet does. Telegram's back
 * button shows while it is open and closes it first (tg/hooks), and it can always be closed
 * with its ✕ (unless `closable` is false: Bible Strong's selection sheet has none) or by swiping
 * it down by the handle or the title.
 */
type SheetProps = {
  open: boolean; onClose: () => void; backdrop?: boolean; closable?: boolean; height?: "auto" | "half" | "full" | "40"; title?: ReactNode; subTitle?: ReactNode; hasBack?: boolean; onBack?: () => void; right?: ReactNode; left?: ReactNode; children?: ReactNode; footer?: ReactNode; className?: string; label?: string;
  /**
   * Snap points (fractions of the height, ascending, the last 1 for full): a form sheet that is
   * dragged between them and leaves the page usable behind it (ui/detents.ts). On a wide window
   * it is a side panel instead, as Bible Strong's web shows its event and study routes.
   */
  detents?: number[]; initialDetent?: number; onDetent?: (index: number) => void; detentNames?: string[];
  /**
   * Bible Strong's form-sheet header (common/Header in a formSheet): the title bold at the left, the
   * right control (their ⋮ menu), a rule under it, and no ✕: the sheet is swiped away, or closed
   * by Escape or Telegram's back button. The side panel keeps a close button.
   */
  form?: boolean;
};

export function Sheet(props: SheetProps) {
  return props.detents ? (props.open ? <DetentSheet {...props} detents={props.detents} /> : null) : <PlainSheet {...props} />;
}

function Header({ title, subTitle, hasBack, onBack, right, left, close, form, closable = true }: Pick<SheetProps, "title" | "subTitle" | "hasBack" | "onBack" | "right" | "left" | "form" | "closable"> & { close: () => void }) {
  if (form) return (
    <div className="bs-sheet__header bs-sheet__header--form">
      {hasBack ? <button type="button" className="bs-iconbtn" aria-label="Back" onClick={onBack ?? close}><Feather name="arrow-left" size={20} /></button> : null}
      <h2 className="bs-sheet__formtitle">{title}</h2>
      {right}
      {closable ? <button type="button" className="bs-iconbtn" aria-label="Close" onClick={close}><Feather name="x" size={18} /></button> : null}
    </div>
  );
  return (
    <div className="bs-sheet__header">
      <div className="bs-sheet__side">{hasBack ? <button type="button" className="bs-iconbtn" aria-label="Back" onClick={onBack ?? close}><Feather name="arrow-left" size={20} /></button> : left}</div>
      <div className="bs-sheet__titles"><b>{title}</b>{subTitle ? <small>{subTitle}</small> : null}</div>
      <div className="bs-sheet__side bs-sheet__side--right">{right}<button type="button" className="bs-iconbtn bs-sheet__close" aria-label="Close" onClick={close}><Feather name="x" size={18} /></button></div>
    </div>
  );
}

/**
 * The form sheet with detents: non-modal (the page stays scrollable and tappable, as the timeline
 * stays under Bible Strong's event sheet), the focus moved in and returned on close but not
 * trapped, Escape, the ✕ and Telegram's back button closing it with the same motion as a swipe.
 * The grabber is a slider for the keyboard (arrow keys move between the detents); a tap on it does
 * nothing. On a wide window it is a side panel, with no drag.
 */
function DetentSheet({ onClose, detents, initialDetent = 0, onDetent, detentNames, title, subTitle, hasBack, onBack, right, left, children, footer, className, label, form }: SheetProps & { detents: number[] }) {
  const wide = useWide();
  const box = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const grab = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(initialDetent);
  const [closing, setClosing] = useState(false);
  const closed = useRef(onClose);
  closed.current = onClose;
  const ctl = useDetents(box, body, grab, { detents, initial: initialDetent, enabled: !wide, onDismissed: () => closed.current(), onDetent: (i) => { setAt(i); onDetent?.(i); } });
  useEffect(() => sheetOpened(), []);
  // Every way out goes through the motion: the sheet slides down, the panel slides away.
  const close = () => { if (ctl.current) ctl.current.dismiss(); else if (wide && !reducedMotion()) setClosing(true); else closed.current(); };
  useModal(box, true, close, { lock: false, trap: false });
  const names = detentNames ?? detents.map((_, i) => (i === detents.length - 1 ? "Full" : i === 0 ? "Peek" : "Expanded"));
  const onKey = (e: RKeyboardEvent) => {
    if (e.key === "ArrowUp" || e.key === "ArrowRight") { e.preventDefault(); ctl.current?.snapTo(at + 1); }
    else if (e.key === "ArrowDown" || e.key === "ArrowLeft") { e.preventDefault(); ctl.current?.snapTo(at - 1); }
  };
  return (
    <div className="sheet__scrim bs-scrim bs-scrim--clear bs-scrim--detents" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div ref={box} className={`bs-sheet ${wide ? "bs-sheet--panel" : "bs-sheet--detents"}${form ? " bs-sheet--form" : ""}${className ? ` ${className}` : ""}`} role="dialog" aria-modal="false" aria-label={label ?? (typeof title === "string" ? title : "Sheet")} data-sheet-open=""
        data-closing={closing ? "" : undefined} onAnimationEnd={(e) => { if (closing && e.target === box.current) closed.current(); }}>
        <div ref={grab} className="bs-sheet__grab">
          {wide ? null : <div className="bs-sheet__handle bs-sheet__handle--slider" role="slider" tabIndex={0} aria-label="Sheet height" aria-valuemin={1} aria-valuemax={detents.length} aria-valuenow={at + 1} aria-valuetext={names[at]} onKeyDown={onKey} />}
          {title !== undefined ? <Header {...{ title, subTitle, hasBack, onBack, right, left, form }} closable={!form || wide} close={close} /> : <button type="button" className="bs-iconbtn bs-sheet__close bs-sheet__close--float" aria-label="Close" onClick={close}><Feather name="x" size={18} /></button>}
        </div>
        <div ref={body} className="bs-sheet__body">{children}</div>
        {footer ? <div className="bs-sheet__footer">{footer}</div> : null}
      </div>
    </div>
  );
}
const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

function PlainSheet({ open, onClose, backdrop = true, height = "auto", title, subTitle, hasBack, onBack, right, left, children, footer, className, label, closable = true }: SheetProps) {
  const [drag, setDrag] = useState(0);
  const [tall, setTall] = useState(false);
  const start = useRef<number | null>(null);
  useEffect(() => { if (open) return sheetOpened(); }, [open]);
  useEffect(() => { if (!open) { setDrag(0); setTall(false); } }, [open]);
  // Swipe by the handle or the title bar: down follows the finger and closes past 90 px; up
  // opens a shorter sheet to full height.
  const down = (e: RPointerEvent) => { if ((e.target as HTMLElement).closest("button")) return; start.current = e.clientY; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); };
  const move = (e: RPointerEvent) => { if (start.current !== null) setDrag(e.clientY - start.current); };
  const up = () => { if (start.current === null) return; start.current = null; if (drag > 90) onClose(); else if (drag < -60 && height !== "full") setTall(true); setDrag(0); };
  // A sheet over a dimmed page holds the focus; one that leaves the page usable (no backdrop) does not.
  const box = useRef<HTMLDivElement>(null);
  useModal(box, open, onClose, { lock: backdrop, trap: backdrop });
  if (!open) return null;
  return (
    <div className={`sheet__scrim bs-scrim${backdrop ? "" : " bs-scrim--clear"}`} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} className={`bs-sheet bs-sheet--${tall ? "full" : height}${className ? ` ${className}` : ""}`} role="dialog" aria-modal={backdrop} aria-label={label ?? (typeof title === "string" ? title : "Sheet")} data-sheet-open=""
        style={drag > 0 ? { transform: `translateY(${drag}px)`, transition: "none" } : undefined}>
        <div className="bs-sheet__grab" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          <div className="bs-sheet__handle" aria-hidden="true" />
          {title !== undefined ? <Header {...{ title, subTitle, hasBack, onBack, right, left }} close={onClose} /> : closable ? <button type="button" className="bs-iconbtn bs-sheet__close bs-sheet__close--float" aria-label="Close" onClick={onClose}><Feather name="x" size={18} /></button> : null}
        </div>
        <div className="bs-sheet__body">{children}</div>
        {footer ? <div className="bs-sheet__footer">{footer}</div> : null}
      </div>
    </div>
  );
}

/** Bible Strong's `Button`: primary fill, or `reverse` (outlined) for a secondary action. */
export function Button({ children, onClick, reverse, disabled, small }: { children: ReactNode; onClick: () => void; reverse?: boolean; disabled?: boolean; small?: boolean }) {
  return <button type="button" className={`bs-btn${reverse ? " bs-btn--reverse" : ""}${small ? " bs-btn--small" : ""}`} disabled={disabled} onClick={onClick}>{children}</button>;
}

/** Bible Strong's `Switch` on the web: a 36×22 track with a white thumb. */
export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className="bs-switchrow" onClick={() => onChange(!on)}>
      <span className="bs-switchrow__label">{label}</span>
      <span className="bs-switch" data-on={on ? "" : undefined}><span /></span>
    </button>
  );
}

export function Checkbox({ checked }: { checked: boolean }) {
  return <span className="bs-checkbox" data-checked={checked ? "" : undefined} aria-hidden="true">{checked ? <Feather name="check" size={14} color="var(--bs-reverse)" /> : null}</span>;
}
