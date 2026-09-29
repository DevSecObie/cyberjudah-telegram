import { useEffect } from "react";

import { useStored } from "@/tg/hooks";
import { app } from "@/tg/sdk";
import { DARK_THEMES, LIGHT_THEMES, PALETTES, type DarkTheme, type LightTheme, type Palette, type ThemeName } from "./theme";

/**
 * The reader's settings, the same set Bible Strong keeps in `user.bible.settings` (and
 * `user.fontFamily`), with its defaults. One CloudStorage key, `bs`.
 */
export type HighlightType = "background" | "textColor" | "underline";
export type CustomColor = { id: string; hex: string; name?: string; type?: HighlightType };
export type DefaultColorKey = "color1" | "color2" | "color3" | "color4" | "color5";
export const DEFAULT_COLOR_KEYS: DefaultColorKey[] = ["color1", "color2", "color3", "color4", "color5"];
export const MAX_CUSTOM_COLORS = 20;

export type BibleSettings = {
  alignContent: "left" | "justify";
  lineHeight: "normal" | "small" | "large";
  fontSizeScale: number;
  textDisplay: "inline" | "block";
  preferredColorScheme: "light" | "dark" | "auto";
  preferredLightTheme: LightTheme;
  preferredDarkTheme: DarkTheme;
  press: "shortPress" | "longPress";
  relationsDisplay: "inline" | "block";
  tagsDisplay: "inline" | "block";
  fontFamily: string;
  shareVerses: { hasVerseNumbers: boolean; hasInlineVerses: boolean; hasQuotes: boolean; hasAppName: boolean };
  /** Overrides of the five default colours' hex, per Bible Strong's `changeColor`. */
  colors: Partial<Record<DefaultColorKey, string>>;
  defaultColorNames: Partial<Record<DefaultColorKey, string>>;
  defaultColorTypes: Partial<Record<DefaultColorKey, HighlightType>>;
  customHighlightColors: CustomColor[];
};

export const DEFAULT_SETTINGS: BibleSettings = {
  alignContent: "left", lineHeight: "normal", fontSizeScale: 0, textDisplay: "inline",
  preferredColorScheme: "auto", preferredLightTheme: "default", preferredDarkTheme: "dark",
  // "Long press" (Bible Strong's default): a tap selects the verse, a long press opens its resources.
  press: "longPress", relationsDisplay: "inline", tagsDisplay: "inline", fontFamily: "Avenir",
  shareVerses: { hasVerseNumbers: true, hasInlineVerses: true, hasQuotes: true, hasAppName: true },
  colors: {}, defaultColorNames: {}, defaultColorTypes: {}, customHighlightColors: [],
};

export function useBibleSettings(): [BibleSettings, (patch: Partial<BibleSettings>) => void] {
  const [stored, set] = useStored<Partial<BibleSettings>>("bs", {});
  const settings: BibleSettings = { ...DEFAULT_SETTINGS, ...stored, shareVerses: { ...DEFAULT_SETTINGS.shareVerses, ...stored.shareVerses } };
  return [settings, (patch) => set({ ...stored, ...patch })];
}

/** The theme in force: the scheme (Telegram's, unless forced) picks the day or the night theme. */
export function resolveTheme(s: BibleSettings, scheme: "light" | "dark"): ThemeName {
  const dark = s.preferredColorScheme === "auto" ? scheme === "dark" : s.preferredColorScheme === "dark";
  return dark ? s.preferredDarkTheme : s.preferredLightTheme;
}
export const telegramScheme = (): "light" | "dark" => app?.colorScheme ?? (matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light");

/** The palette with the reader's own highlight colours in place of color1–5. */
export function paletteOf(theme: ThemeName, s: BibleSettings): Palette {
  return { ...PALETTES[theme], ...s.colors };
}

export const THEME_LABEL: Record<ThemeName, string> = Object.fromEntries([...LIGHT_THEMES, ...DARK_THEMES].map((t) => [t.id, t.label])) as Record<ThemeName, string>;

/** Bible Strong's font list on the web: Literata Book first, then the browser faces. */
export const FONTS = ["Literata Book", "Georgia", "Arial", "Helvetica", "Times New Roman", "monospace"];
const SYSTEM_SANS = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
/** webFontFamily: keep a chosen face when installed, with a deliberate fallback. */
export function webFontFamily(f?: string): string {
  if (!f || ["System", "normal", "Roboto", "Avenir"].includes(f)) return SYSTEM_SANS;
  if (f.includes(",")) return f;
  if (["serif", "sans-serif", "monospace", "system-ui"].includes(f)) return f;
  if (f === "Literata Book") return '"Literata", "Literata Book", Georgia, serif';
  if (["Georgia", "Times New Roman", "Baskerville", "Didot", "Iowan Old Style", "American Typewriter"].includes(f)) return `${JSON.stringify(f)}, Georgia, serif`;
  return `${JSON.stringify(f)}, ${SYSTEM_SANS}`;
}

/** Every highlight colour on the bar, in order: the five defaults then the custom ones. */
export function colorItems(s: BibleSettings, p: Palette): { key: string; hex: string; name?: string; type: HighlightType }[] {
  return [
    ...DEFAULT_COLOR_KEYS.map((k) => ({ key: k, hex: p[k], name: s.defaultColorNames[k], type: s.defaultColorTypes[k] ?? "background" })),
    ...s.customHighlightColors.map((c) => ({ key: c.id, hex: c.hex, name: c.name, type: c.type ?? "background" })),
  ];
}
/** resolveHighlightInfo: a colour id to its hex and type. */
export function highlightInfo(colorId: string, s: BibleSettings, p: Palette): { hex: string; type: HighlightType } {
  if (colorId.startsWith("color")) return { hex: p[colorId as DefaultColorKey] || "transparent", type: s.defaultColorTypes[colorId as DefaultColorKey] ?? "background" };
  const c = s.customHighlightColors.find((x) => x.id === colorId);
  return { hex: c?.hex || "transparent", type: c?.type ?? "background" };
}

/** Telegram's scheme changes reach the reader live. */
export function useSchemeChange(fn: () => void) {
  useEffect(() => {
    if (!app) return;
    const a = app;
    a.onEvent("themeChanged", fn);
    return () => a.offEvent("themeChanged", fn);
  }, [fn]);
}
