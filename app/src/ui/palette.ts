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

/** Keep the hue where possible, moving toward the endpoint that works on every surface. */
export function readableColor(value: string, grounds: RGB[], ratio = 4.6): string {
  const source = parseColor(value);
  const score = (color: RGB) => Math.min(...grounds.map(g => contrast(color, g)));
  const ends: RGB[] = [[0, 0, 0], [255, 255, 255]];
  const end = score(ends[0]) > score(ends[1]) ? ends[0] : ends[1];
  for (let step = 0; step <= 100; step++) {
    const candidate = parseColor(toHex(mix(end, source, step / 100)));
    if (score(candidate) >= ratio) return toHex(candidate);
  }
  return toHex(end);
}

/** Reuse expensive contrast calculations across renders, keyed by actual palette values. */
export function memoizePalette<T extends unknown[]>(compute: (...args: T) => Record<string, string>) {
  const cache = new Map<string, Record<string, string>>();
  return (...args: T): Record<string, string> => {
    const key = JSON.stringify(args), saved = cache.get(key);
    if (saved) return saved;
    const vars = Object.freeze(compute(...args));
    if (cache.size >= 24) cache.delete(cache.keys().next().value!);
    cache.set(key, vars);
    return vars;
  };
}

/** UI ink must also read on inset/pressed surfaces and glass over either extreme backdrop. */
export function paletteGrounds(p: Palette, dark: boolean): RGB[] {
  const page = parseColor(p.reverse), card = parseColor(p.lightGrey), ink = parseColor(p.default);
  const surfaces = [page, card, parseColor(p.border)];
  return [...surfaces, ...surfaces.map(g => mix(ink, g, dark ? .15 : .12)),
    ...[[0, 0, 0], [255, 255, 255]].flatMap(back => [mix(page, back as RGB, .8), mix(card, back as RGB, .93)])];
}

/** Secondary ink stays quiet only as far as every actual ground permits. */
function inkAt(ink: RGB, page: RGB, grounds: RGB[], ratio: number): string {
  return readableColor(toHex(mix(ink, page, .5)), grounds, ratio);
}

export const appVars = memoizePalette((p: Palette, dark: boolean): Record<string, string> => {
  const ink = parseColor(p.default), page = parseColor(p.reverse), card = parseColor(p.lightGrey);
  const grounds = paletteGrounds(p, dark);
  return {
    "--canvas": toHex(page),
    "--canvas-glow": `color-mix(in srgb, ${p.primary} ${dark ? 9 : 7}%, transparent)`,
    "--surface-1": toHex(card),
    "--surface-2": toHex(parseColor(p.border)),
    "--fill-1": `color-mix(in srgb, ${toHex(ink)} ${dark ? 6 : 5}%, transparent)`,
    "--fill-2": `color-mix(in srgb, ${toHex(ink)} ${dark ? 10 : 8}%, transparent)`,
    "--fill-3": `color-mix(in srgb, ${toHex(ink)} ${dark ? 15 : 12}%, transparent)`,
    "--text-1": readableColor(toHex(ink), grounds),
    "--text-2": inkAt(ink, page, grounds, 7),
    "--text-3": inkAt(ink, page, grounds, 4.6),
    "--text-4": inkAt(ink, page, grounds, 4.5),
    "--text-inverse": toHex(page),
    "--accent": readableColor(p.primary, grounds),
    "--on-accent": dark ? "#00161c" : "#ffffff",
    "--hairline": toHex(parseColor(p.border)),
    "--control-edge": inkAt(ink, page, grounds, 3.1),
    "--palette-canvas": toHex(page), "--palette-card": toHex(card), "--palette-inset": toHex(parseColor(p.border)),
    ...Object.fromEntries(Object.entries(dark
      ? { danger: "#ff5c93", success: "#3ddc97", warning: "#fbbf24", gold: "#d9b45c", violet: "#b9a2ff", sky: "#7cb8ff" }
      : { danger: "#b8124f", success: "#0a6e4c", warning: "#8a5a00", gold: "#7d5f17", violet: "#6a48c9", sky: "#1f5fb8" })
      .map(([key, value]) => [`--${key}`, readableColor(value, grounds)])),
  };
});
