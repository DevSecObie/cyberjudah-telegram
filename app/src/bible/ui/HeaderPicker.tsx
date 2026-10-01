import { useEffect, useRef, type ReactNode } from "react";
import { sheetOpened } from "@/tg/hooks";
import { Feather } from "../icons";

/** Header selectors share a bounded, scrolling card and Telegram's overlay back behavior. */
export function HeaderPicker({ open, onClose, title, onBack, right, children }: {
  open: boolean; onClose: () => void; title: string; onBack?: () => void; right?: ReactNode; children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const release = sheetOpened();
    const trigger = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => { release(); if (trigger?.isConnected) trigger.focus(); };
  }, [open]);
  if (!open) return null;
  return (
    <div className="sheet__scrim bs-picker-scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className="bs-picker" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} data-sheet-open=""
        onKeyDown={(e) => {
          if (e.key === "Escape") { e.stopPropagation(); onClose(); }
          if (e.key !== "Tab") return;
          const items = ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]');
          if (!items?.length) return;
          const first = items[0], last = items[items.length - 1];
          if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && (document.activeElement === last || document.activeElement === ref.current)) { e.preventDefault(); first.focus(); }
        }}>
        <div className="bs-picker__header">
          {onBack ? <button type="button" className="bs-iconbtn" aria-label="Back to books" onClick={onBack}><Feather name="arrow-left" size={20} /></button> : null}
          <b>{title}</b>{right}
          <button type="button" className="bs-iconbtn" aria-label="Close" onClick={onClose}><Feather name="x" size={18} /></button>
        </div>
        <div className="bs-picker__body">{children}</div>
      </div>
    </div>
  );
}
