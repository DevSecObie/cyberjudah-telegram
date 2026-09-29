import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { haptic } from "@/tg/sdk";

/**
 * Pull to refresh on a screen that scrolls the page: a downward pull from the top past 72 px
 * ticks (haptic) and refetches every query the screen holds; the pull distance is exposed so
 * the screen can show a small indicator. Telegram's own swipe-to-close is left alone: the
 * pull only counts while the page is at its very top and moving mostly downwards.
 */
export function usePullToRefresh(enabled = true) {
  const qc = useQueryClient();
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const start = useRef<{ y: number; x: number } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const down = (e: TouchEvent) => { start.current = (window.scrollY <= 0 && e.touches.length === 1) ? { y: e.touches[0].clientY, x: e.touches[0].clientX } : null; };
    const move = (e: TouchEvent) => {
      if (!start.current || window.scrollY > 0) return;
      const dy = e.touches[0].clientY - start.current.y, dx = Math.abs(e.touches[0].clientX - start.current.x);
      if (dy > 8 && dy > dx * 2) setPull(Math.min(96, dy * 0.6)); else if (dy < 0) setPull(0);
    };
    const up = async () => {
      if (!start.current) return;
      const armed = pullRef.current >= 72;
      start.current = null;
      setPull(0);
      if (!armed || busyRef.current) return;
      haptic("success"); setBusy(true); busyRef.current = true;
      try { await qc.refetchQueries({ type: "active" }); } finally { setBusy(false); busyRef.current = false; }
    };
    window.addEventListener("touchstart", down, { passive: true });
    window.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("touchend", up);
    window.addEventListener("touchcancel", up);
    return () => { window.removeEventListener("touchstart", down); window.removeEventListener("touchmove", move); window.removeEventListener("touchend", up); window.removeEventListener("touchcancel", up); };
  }, [enabled, qc]);
  const pullRef = useRef(0); pullRef.current = pull;
  const busyRef = useRef(false);
  return { pull, busy };
}

/** The small indicator above a pulled screen. */
export function pullStyle(pull: number, busy: boolean): { height: number; opacity: number; label: string } {
  return { height: busy ? 28 : pull * 0.4, opacity: busy ? 1 : Math.min(1, pull / 72), label: busy ? "Refreshing…" : pull >= 72 ? "Release to refresh" : "Pull to refresh" };
}
