/**
 * Whether a touch is landing on a page that is still gliding after a swipe. A finger put down on
 * it stops it, as on iOS, and is not a tap: the browser drops that click, and our own touch
 * handlers (the dock's touchend activation, the reader's verse taps) must drop theirs too.
 * Only momentum counts: a page the app scrolls itself (a verse brought to the middle) stays tappable.
 */
let touching = false, panned = false, lastScroll = 0, lastGlide = 0;
if (typeof window !== "undefined") {
  const opts = { capture: true, passive: true } as const;
  addEventListener("touchstart", () => { touching = true; panned = false; }, opts);
  const lift = () => { touching = false; lastScroll = performance.now(); };
  addEventListener("touchend", lift, opts);
  addEventListener("touchcancel", lift, opts);
  addEventListener("scroll", () => {
    const now = performance.now();
    if (touching) panned = true;
    // The glide runs on from the finger without a break; a scroll after a pause is the app's own.
    else if (panned && now - lastScroll < 100) lastGlide = now;
    else panned = false;
    lastScroll = now;
  }, opts);
}

/** Scroll events come every frame while a page glides; 100 ms without one means it has stopped. */
export const stoppingScroll = () => performance.now() - lastGlide < 100;
