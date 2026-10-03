import { useEffect, useRef, type RefObject } from "react";

/**
 * What every sheet and dialog does while it is open: the page behind stops scrolling (without a
 * jump), the focus moves inside and stays there (Tab and Shift+Tab wrap), Escape closes it, and
 * the focus goes back to whatever opened it when it closes.
 */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
let locks = 0;
/** Open dialogs, innermost last: only the innermost answers Escape and Tab. */
const stack: object[] = [];
/** The last thing focused outside any dialog: where the focus returns to. */
let outside: HTMLElement | null = null;
if (typeof document !== "undefined") document.addEventListener("focusin", (e) => { const t = e.target as HTMLElement; if (!t.closest?.('[role="dialog"]')) outside = t; }, true);

export function useModal(ref: RefObject<HTMLElement | null>, open: boolean, onClose?: () => void, opts: { lock?: boolean; trap?: boolean } = {}) {
  const { lock = true, trap = true } = opts;
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const me = {};
    stack.push(me);
    const root = document.documentElement;
    const active = document.activeElement as HTMLElement | null;
    const trigger = active && !ref.current?.contains(active) ? active : outside;
    if (lock) { locks++; root.dataset.modal = ""; }
    // Into the dialog: an element asking for it (autofocus), else the dialog itself.
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>("[autofocus], [data-autofocus]");
    // (Something inside that already took the focus, such as an autoFocus field, keeps it.)
    if (el?.contains(document.activeElement)) { /* keep */ } else if (first) first.focus(); else if (el) { if (!el.hasAttribute("tabindex")) el.tabIndex = -1; el.focus({ preventScroll: true }); }
    const onKey = (e: KeyboardEvent) => {
      const box = ref.current; if (!box || stack[stack.length - 1] !== me) return;
      if (e.key === "Escape" && close.current) { e.stopPropagation(); close.current(); return; }
      if (!trap || e.key !== "Tab") return;
      const items = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null);
      if (!items.length) { e.preventDefault(); return; }
      const a = items[0], z = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === a || document.activeElement === box)) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      stack.splice(stack.indexOf(me), 1);
      if (lock && --locks <= 0) { locks = 0; delete root.dataset.modal; }
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lock, trap]);
}
