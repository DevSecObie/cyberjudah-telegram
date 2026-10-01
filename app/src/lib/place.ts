import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigationType } from "react-router";

/**
 * The reader's place on a screen, kept for this visit: how far down they were and what they had
 * opened. Going on to a verse and coming back (Telegram's back, the browser's back) returns them
 * to it; a new visit to the screen starts at the top. Kept in session storage under the history
 * entry's key, so each visit has its own.
 */
const read = <T,>(k: string): T | undefined => { try { const v = sessionStorage.getItem(k); return v == null ? undefined : JSON.parse(v) as T; } catch { return undefined; } };
const write = (k: string, v: unknown) => { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };

/** A piece of a screen's state (a search, a "show all") that survives going on and coming back. */
export function useVisitState<T>(name: string, initial: T): [T, (next: T | ((prev: T) => T)) => void] {
  const { key } = useLocation();
  const k = `visit:${key}:${name}`;
  const nav = useNavigationType();
  const [value, setValue] = useState<T>(() => read<T>(k) ?? initial);
  const latest = useRef(value);
  latest.current = value;
  const seen = useRef(k);
  useEffect(() => {
    if (seen.current === k) return;
    seen.current = k;
    const kept = read<T>(k);
    // A filter changed in place (a replace) is the same visit: what was typed goes with it.
    if (kept === undefined && nav === "REPLACE") write(k, latest.current);
    else setValue(kept ?? initial);
  }, [k]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = useCallback((next: T | ((prev: T) => T)) => setValue((prev) => {
    const v = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
    write(k, v); return v;
  }), [k]);
  return [value, set];
}

/** The page's scroll position for this visit: saved as they scroll, put back once the screen's content is `ready`. */
export function useKeptScroll(ready: boolean) {
  const { key } = useLocation();
  const k = `visit:${key}:y`;
  const restored = useRef<string | null>(null);
  useEffect(() => {
    let raf = 0;
    const save = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { if (restored.current === k) write(k, Math.round(window.scrollY)); }); };
    window.addEventListener("scroll", save, { passive: true });
    return () => { window.removeEventListener("scroll", save); cancelAnimationFrame(raf); };
  }, [k]);
  useLayoutEffect(() => {
    if (!ready || restored.current === k) return;
    const y = read<number>(k) ?? 0;
    window.scrollTo(0, y);
    // Content below may still be arriving (a card's verse); hold the place until it has.
    if (y > 0) { let n = 0; const hold = () => { if (window.scrollY < y - 2 && n++ < 20) { window.scrollTo(0, y); requestAnimationFrame(hold); } else restored.current = k; }; requestAnimationFrame(hold); }
    else restored.current = k;
  }, [ready, k]);
}
