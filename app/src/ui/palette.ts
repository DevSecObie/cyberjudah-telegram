import type { Palette } from "@/bible/theme";

/**
 * The app's colour tokens, taken from the reader's palette, so the whole app wears the theme
 * chosen in the Bible (Paper, Sepia, Nature, Sunset, Dark, Black, Mauve, Night blue). The page
 * is the reader's page, cards its light grey, lines its border, text its ink; the secondary
 * inks are mixed toward the page only as far as they still read (4.5:1 on page and card).
 */
type RGB = [number, number, number];

export function parseColor(c: string): RGB {
  const s = c.trim();
  if (s.startsWith("#")) { const h = s.slice(1); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB; }
  const m = s.match(/[\d.]+/g) ?? ["0", "0", "0"];
  return [Number(m[0]), Number(m[1]), Number(m[2])];
}
export const toHex = (c: RGB) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;
const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((i) => a[i] * t + b[i] * (1 - t)) as RGB;
const lum = (c: RGB) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const contrast = (a: RGB, b: RGB) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

/** The ink mixed furthest toward the page that still meets `ratio` on every ground. */
function inkAt(ink: RGB, page: RGB, grounds: RGB[], ratio: number): string {
  for (let t = 0.5; t < 1; t += 0.02) { const c = mix(ink, page, t); if (grounds.every((g) => contrast(c, g) >= ratio)) return toHex(c); }
  return toHex(ink);
}

export function appVars(p: Palette, dark: boolean): Record<string, string> {
  const ink = parseColor(p.default), page = parseColor(p.reverse), card = parseColor(p.lightGrey);
  const grounds = [page, card];
  return {
    "--canvas": toHex(page),
    "--canvas-glow": `color-mix(in srgb, ${p.primary} ${dark ? 9 : 7}%, transparent)`,
    "--surface-1": toHex(card),
    "--surface-2": toHex(parseColor(p.border)),
    "--fill-1": `color-mix(in srgb, ${toHex(ink)} ${dark ? 6 : 5}%, transparent)`,
    "--fill-2": `color-mix(in srgb, ${toHex(ink)} ${dark ? 10 : 8}%, transparent)`,
    "--fill-3": `color-mix(in srgb, ${toHex(ink)} ${dark ? 15 : 12}%, transparent)`,
    "--text-1": toHex(ink),
    "--text-2": inkAt(ink, page, grounds, 7),
    "--text-3": inkAt(ink, page, grounds, 4.6),
    "--text-4": inkAt(ink, page, grounds, 4.5),
    "--text-inverse": toHex(page),
    "--accent": p.primary,
    "--on-accent": dark ? "#00161c" : "#ffffff",
    "--hairline": toHex(parseColor(p.border)),
    "--control-edge": inkAt(ink, page, grounds, 3),
  };
}
