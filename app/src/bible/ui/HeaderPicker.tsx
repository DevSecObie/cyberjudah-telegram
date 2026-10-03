import { useEffect, useRef, type ReactNode } from "react";
import { sheetOpened } from "@/tg/hooks";
import { useModal } from "@/ui/modal";
import { usePopover } from "@/ui/popover";
import { Feather } from "../icons";

/** Header selectors share a bounded, scrolling card and Telegram's overlay back behavior. */
export function HeaderPicker({ open, onClose, title, onBack, right, children }: {
  open: boolean; onClose: () => void; title: string; onBack?: () => void; right?: ReactNode; children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) return sheetOpened(); }, [open]);
  const present = usePopover(open, ref);
  useModal(ref, open && present, onClose);
  if (!present) return null;
  return (
    <div className="sheet__scrim bs-picker-scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className="bs-picker" data-popover="" inert={!open} aria-hidden={!open} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} data-sheet-open=""
>
        <div className="bs-picker__header">
          {onBack ? <button type="button" className="bs-iconbtn" aria-label="Back to books" title="Back to books" onClick={onBack}><Feather name="arrow-left" size={20} /></button> : null}
          <b>{title}</b>{right}
          <button type="button" className="bs-iconbtn" aria-label="Close" title="Close" onClick={onClose}><Feather name="x" size={18} /></button>
        </div>
        <div className="bs-picker__body">{children}</div>
      </div>
    </div>
  );
}
