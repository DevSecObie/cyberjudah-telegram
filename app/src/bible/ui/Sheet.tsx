import { useEffect, useRef, type ReactNode } from "react";
import { Drawer } from "vaul";

import { sheetOpened } from "@/tg/hooks";
import { useModal } from "@/ui/modal";

import { Feather } from "../icons";
import "./sheet.css";
import { Button as ControlButton } from "@/ui/Button";

/** A detent: a fraction of the tallest a sheet can be, or "auto", its content's height. */
export type SnapPoint = number | "auto";

const LEGACY: Record<"auto" | "half" | "full" | "40", SnapPoint[]> = { auto: ["auto"], half: [0.5], full: [1], "40": [0.4] };

/**
 * Bible Strong's bottom sheet on the web (common/sheet.web.tsx → @expo/ui's BottomSheet, a vaul
 * drawer): vaul opens, closes and drags it, moving the sheet itself rather than redrawing the page.
 *
 * - Detents: `snapPoints`, `["auto"]` (the content's height) unless given; it opens at the first,
 *   whose height it keeps (BottomSheet.tsx sets the drawer's height to the snap point).
 * - With a backdrop the page behind is dimmed and a tap on it closes the sheet; with `backdrop`
 *   false (BottomSheet's `backdropComponent={null}`), or dimmed only from a later detent, it is a
 *   nonmodal drawer and the page stays usable.
 * - `dismissible` false: no swipe, tap or Back closes it. A sheet closes by a swipe down, a tap
 *   outside, Escape or Telegram's Back.
 * - The header (SheetHeader): 54 px, the title in 16 px bold, left-aligned unless `centerTitle`,
 *   the subtitle 13 px grey under it, a back arrow or `left`, `right`, then `headerChildren` (a
 *   search field), with a line under it. The footer (SheetFooter): 8 px by 20 px, no line.
 * - `background` "reverse" is the page colour (Bible Strong's sheets given a backgroundColor).
 *
 * `height` is the older way to say the detents ("half" is [0.5], "full" [1], "40" [0.4]).
 */
export function Sheet({ open, onClose, backdrop: withBackdrop = true, height, snapPoints, dimFrom = 0, background = "glass", title, subTitle, centerTitle = false, hasBack, onBack, right, left, headerChildren, children, footer, className, label, closable = true, dismissible, draggable = true, actions = false }: {
  open: boolean; onClose: () => void; backdrop?: boolean; height?: "auto" | "half" | "full" | "40"; snapPoints?: SnapPoint[]; background?: "glass" | "reverse";
  title?: ReactNode; subTitle?: ReactNode; centerTitle?: boolean; hasBack?: boolean; onBack?: () => void; right?: ReactNode; left?: ReactNode; headerChildren?: ReactNode;
  children?: ReactNode; footer?: ReactNode; className?: string; label?: string; closable?: boolean; dismissible?: boolean; draggable?: boolean; actions?: boolean;
  /** The first detent the page is dimmed from; a sheet stays at its first, so a later one leaves the page usable. */ dimFrom?: number;
  /** No longer used: a sheet's detents say whether it grows. */ expandable?: boolean;
  /** No longer used: every sheet moves with its content, as a native one does. */ dragAnywhere?: boolean;
}) {
  const detent = (snapPoints?.length ? snapPoints : LEGACY[height ?? "auto"])[0];
  const canDismiss = dismissible ?? closable;
  const backdrop = withBackdrop && dimFrom === 0;
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) return sheetOpened(); }, [open]);
  // Escape reaches both our modal handling and the dialog's; the sheet asks to close once.
  const closing = useRef(false);
  useEffect(() => { if (open) closing.current = false; }, [open]);
  const close = () => { if (closing.current || !canDismiss) return; closing.current = true; onClose(); };
  useModal(box, open, canDismiss ? close : undefined, { lock: backdrop, trap: backdrop });
  // Telegram's Back closes the top sheet with cj:close (tg/hooks), now that the overlay is not its parent.
  useEffect(() => {
    const el = box.current; if (!open || !el) return;
    const onBack = () => close();
    el.addEventListener("cj:close", onBack);
    return () => el.removeEventListener("cj:close", onBack);
  });
  // A field, a slider or a marked area keeps its own drag: vaul neither moves the sheet nor holds
  // the pointer for it, as the sheet before it left them alone.
  const keepDrag = (e: React.PointerEvent) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>("input, textarea, select, [contenteditable], [data-sheet-nodrag]");
    if (!t) return;
    t.setAttribute("data-vaul-no-drag", "");
    const target = e.target as Element, id = e.pointerId;
    queueMicrotask(() => { if (target.hasPointerCapture?.(id)) target.releasePointerCapture(id); });
  };
  const header = title !== undefined || subTitle !== undefined || hasBack || left || right || headerChildren;
  const size = detent === "auto" ? undefined : `calc(${detent} * var(--sheet-max))`;
  const name = label ?? (typeof title === "string" ? title : "Sheet");
  return (
    <Drawer.Root open={open} onOpenChange={(o) => { if (!o) close(); }} dismissible={canDismiss && draggable} modal={backdrop}>
      <Drawer.Overlay className="sheet__scrim bs-scrim" />
      <Drawer.Content ref={box} className={`bs-sheet bs-sheet--${detent === 1 ? "full" : detent === "auto" ? "auto" : detent === 0.5 ? "half" : "part"}${className ? ` ${className}` : ""}`} aria-label={name} aria-describedby={undefined} aria-modal={backdrop} onPointerDown={keepDrag}
        data-sheet-open="" data-clear={backdrop ? undefined : ""} data-background={background} data-actions={actions && detent !== 1 ? "" : undefined} style={{ height: size }}>
        <Drawer.Title className="sr-only">{name}</Drawer.Title>
        <div className="bs-sheet__grab">
          {draggable ? <Drawer.Handle className="bs-sheet__grabber" aria-hidden="true" /> : null}
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
      </Drawer.Content>
    </Drawer.Root>
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
