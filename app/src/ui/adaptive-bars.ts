// iOS 26's small glass (the tab bar, a toolbar) flips between light and dark with the content
// passing under it, and its glyphs flip with it (Apple, "Meet Liquid Glass"). Here the dock reads
// the colour of the content beneath its middle row and flips when that content is far from the
// app's own scheme: a light card under the dark dock, a dark one under the light dock. Pictures
// and video can't be read from a web page, so over them the dock keeps the app's scheme.

const BARS = ".tabs";
const SKIP = ".tabs, .glass-light, .pageactions, .audio-player, .toasts, [data-sheet-open], .bs-scrim, .sheet__scrim";

function luminance(color: string): number | null {
  const m = color.match(/rgba?\(([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+%?))?/);
  if (!m) return null;
  const a = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  if (a < .6) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map(v => { const c = parseFloat(v) / 255; return c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; });
  return .2126 * r + .7152 * g + .0722 * b;
}

/** The luminance of the first opaque content under a point, or null over media or nothing. The
 * overlays above the content take no hits while sampling (html[data-bar-sampling]), so a single
 * hit test lands on the content itself; this never measures words. */
function under(x: number, y: number): number | null {
  for (let el = document.elementFromPoint(x, y); el && el !== document.documentElement; el = el.parentElement) {
    if (el.closest(SKIP)) return null;
    if (el instanceof HTMLImageElement || el instanceof HTMLVideoElement || el instanceof HTMLCanvasElement || el instanceof HTMLIFrameElement) return null;
    const l = luminance(getComputedStyle(el).backgroundColor);
    if (l !== null) return l;
  }
  return null;
}

function update() {
  const dark = getComputedStyle(document.documentElement).colorScheme.includes("dark");
  for (const bar of document.querySelectorAll<HTMLElement>(BARS)) {
    const r = bar.getBoundingClientRect();
    if (!r.width) continue;
    const y = r.top + r.height / 2;
    const root = document.documentElement;
    root.setAttribute("data-bar-sampling", "");
    const samples = [.2, .5, .8].map(f => under(r.left + r.width * f, y)).filter((l): l is number => l !== null);
    root.removeAttribute("data-bar-sampling");
    const l = samples.length ? samples.reduce((a, b) => a + b, 0) / samples.length : null;
    const over = l === null ? null : dark && l > .45 ? "light" : !dark && l < .08 ? "dark" : null;
    if (over) bar.dataset.over = over; else delete bar.dataset.over;
  }
}

let installed = false;
export function installAdaptiveBars() {
  if (installed || typeof document === "undefined") return;
  installed = true;
  let frame = 0;
  const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; update(); }); };
  addEventListener("scroll", schedule, { capture: true, passive: true });
  addEventListener("resize", schedule);
  // Route changes and late content: a light check after the page settles.
  let settle = 0;
  new MutationObserver(() => { clearTimeout(settle); settle = window.setTimeout(schedule, 250); }).observe(document.body, { childList: true, subtree: true });
  schedule();
}
