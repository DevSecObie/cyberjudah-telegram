import { useEffect, useRef, useState, type RefObject } from "react";
import "./verse-jump.css";

/** Bible Strong's bibleKeyboardActions.parseVerseDestination. */
export function parseVerseDestination(value: string, verseCount?: number): number | undefined {
  if (!verseCount || !/^\d+$/.test(value.trim())) return;
  const verse = Number(value.trim());
  return Number.isInteger(verse) && verse >= 1 && verse <= verseCount ? verse : undefined;
}

/** Bible Strong's bibleKeyboardActions.isBibleShortcut. */
const isShortcut = (e: KeyboardEvent, key: string) => e.key.toLowerCase() === key && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.repeat && !e.isComposing;
const editing = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || !!target.closest('input,textarea,select,[role="textbox"]'));

/**
 * Bible Strong's BibleVerseKeyboardDialog.web: `v` opens "Go to verse" for the reader in view,
 * unless something is being edited or a dialog or menu is already open. Closing returns focus.
 */
export function VerseJump({ root, label, count, onNavigate }: { root: RefObject<HTMLElement | null>; label: string; count: number; onNavigate: (verse: number) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!count) return;
    const onKey = (e: KeyboardEvent) => {
      const el = root.current;
      // Only the reader on screen answers: kept-alive tabs stay mounted but hidden.
      if (!el || !el.getClientRects().length || el.closest('[inert], [hidden], [aria-hidden="true"]')) return;
      if (!isShortcut(e, "v") || e.defaultPrevented || editing(e.target)) return;
      // Closed sheets stay mounted but inert here, so only a live dialog or menu blocks it.
      if ([...document.querySelectorAll('[data-sheet-open], [role="dialog"], [role="alertdialog"], [role="menu"], [aria-modal="true"]')].some(d => d.getAttribute("aria-modal") !== "false" && !d.closest('[inert], [aria-hidden="true"]'))) return;
      e.preventDefault(); e.stopPropagation();
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setQuery(""); setOpen(true);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [root, count]);
  useEffect(() => { setOpen(false); }, [label]);
  useEffect(() => { if (open) input.current?.focus(); else if (returnFocus.current?.isConnected) returnFocus.current.focus(); }, [open]);
  if (!open) return null;
  const destination = parseVerseDestination(query, count);
  return <>
    <div className="bs-command-overlay" onClick={() => setOpen(false)} />
    <div className="bs-command-dialog bs-verse-jump" role="dialog" aria-modal="true" aria-labelledby="bs-verse-jump-title" onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); setOpen(false); } }}>
      <h2 id="bs-verse-jump-title">Go to verse</h2>
      <p>{label} · Verse 1–{count}</p>
      <form onSubmit={(e) => { e.preventDefault(); if (destination === undefined) return; onNavigate(destination); setOpen(false); }}>
        <input ref={input} inputMode="numeric" autoComplete="off" value={query} aria-label="Verse" aria-invalid={!!query && destination === undefined} onChange={(e) => setQuery(e.target.value)} placeholder="18" />
        <button type="submit" disabled={destination === undefined}>Go</button>
      </form>
    </div>
  </>;
}
