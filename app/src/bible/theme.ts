/**
 * Bible Strong's colour palettes, verbatim (apps/expo/src/themes/*Colors.ts), and the
 * helpers its Bible DOM uses to derive highlight and contrast colours (helpers/highlightUtils,
 * BibleDOM/convertHex, BibleDOM/utils). The reader picks a day theme and a night theme; the
 * colour scheme follows Telegram's, or is forced day or night.
 */
export type ThemeName = "default" | "sepia" | "nature" | "sunset" | "dark" | "black" | "mauve" | "night";
export type LightTheme = "default" | "sepia" | "nature" | "sunset";
export type DarkTheme = "dark" | "black" | "mauve" | "night";
export type Palette = {
  default: string; opacity5: string; reverse: string; border: string; lightGrey: string; grey: string; darkGrey: string;
  primary: string; lightPrimary: string; secondary: string; lightSecondary: string; tertiary: string; quart: string; quint: string; success: string;
  color1: string; color2: string; color3: string; color4: string; color5: string;
};

const light = { secondary: "rgb(255,188,0)", lightSecondary: "rgb(255, 238, 198)", tertiary: "rgb(98,113,122)", quart: "rgb(194,40,57)", quint: "rgb(48, 51, 107)", success: "#2ecc71", color1: "#81ecec", color2: "#ff7675", color3: "#fdcb6e", color4: "#74b9ff", color5: "#95afc0" };
const dark = { secondary: "rgb(255,188,0)", lightSecondary: "rgba(255,188,0, 0.15)", tertiary: "rgb(166,190,204)", quart: "rgb(194,40,57)", quint: "rgb(253, 121, 168)", success: "#2ecc71", color1: "#81ecec", color2: "#ff7675", color3: "#fdcb6e", color4: "#74b9ff", color5: "#9b59b6" };

export const PALETTES: Record<ThemeName, Palette> = {
  default: { default: "rgb(0,0,0)", opacity5: "rgba(0,0,0,0.05)", reverse: "rgb(255,255,255)", border: "rgb(230,230,230)", lightGrey: "#F4F7FF", grey: "rgb(78,79,79)", darkGrey: "rgba(0,0,0,0.5)", primary: "rgb(89,131,240)", lightPrimary: "rgb(233, 243, 252)", ...light },
  sepia: { default: "rgb(72,54,35)", opacity5: "rgba(72,54,35,0.05)", reverse: "rgb(245,242,227)", border: "#E1DDCA", lightGrey: "#ebded1", grey: "rgb(171, 138, 106)", darkGrey: "rgba(72,54,35,0.5)", primary: "rgb(125,123,168)", lightPrimary: "rgb(228, 228, 245)", ...light },
  nature: { default: "rgb(27, 108, 50)", opacity5: "rgba(27, 108, 50, 0.05)", reverse: "rgb(253,255,253)", border: "#DEEFDE", lightGrey: "#EAF9EC", grey: "rgb(41,70,50)", darkGrey: "rgba(0,0,0,0.5)", primary: "rgb(211,78,110)", lightPrimary: "rgb(255, 194, 209)", ...light },
  sunset: { default: "rgb(103, 87, 124)", opacity5: "rgba(27, 108, 50, 0.05)", reverse: "#FFFAF8", border: "#F5E8E2", lightGrey: "#FAE7DF", grey: "rgb(68,60,80)", darkGrey: "rgba(0,0,0,0.5)", primary: "rgb(200,148,186)", lightPrimary: "rgb(246, 202, 216)", ...light },
  dark: { default: "rgb(200,200,200)", opacity5: "rgba(200,200,200,0.05)", reverse: "rgb(18,45,66)", border: "#253e51", lightGrey: "rgb(30, 61, 82)", grey: "rgb(150,150,150)", darkGrey: "rgba(255, 255, 255, 0.5)", primary: "rgb(14,211,185)", lightPrimary: "rgba(14, 211, 185, 0.5)", ...dark },
  black: { default: "rgb(200,200,200)", opacity5: "rgba(200,200,200,0.05)", reverse: "rgb(0,0,0)", border: "#272727", lightGrey: "rgb(20, 20, 20)", grey: "rgb(150,150,150)", darkGrey: "rgba(255, 255, 255, 0.5)", primary: "rgb(89,131,240)", lightPrimary: "rgba(89,131,240, 0.3)", ...dark },
  mauve: { default: "rgb(228,194,225)", opacity5: "rgba(200,200,200,0.05)", reverse: "rgb(51,4,46)", border: "rgb(72, 19, 66)", lightGrey: "rgb(66, 14, 60)", grey: "rgb(150,150,150)", darkGrey: "rgba(255, 255, 255, 0.5)", primary: "rgb(14,211,185)", lightPrimary: "rgba(14,211,185, 0.5)", ...dark },
  night: { default: "rgb(198,225,255)", opacity5: "rgba(200,200,200,0.05)", reverse: "rgb(0,50,100)", border: "#164778", lightGrey: "rgb(17, 69, 120)", grey: "rgb(150,170,187)", darkGrey: "rgba(255, 255, 255, 0.5)", primary: "rgb(14,211,185)", lightPrimary: "rgba(14, 211, 185, 0.5)", secondary: "rgb(255,240,187)", lightSecondary: "rgba(255,240,187, 0.3)", tertiary: "rgb(160,220,255)", quart: "rgb(224,128,138)", quint: "rgb(253, 121, 168)", success: "#2ecc71", color1: "#81ecec", color2: "#ff7675", color3: "#fdcb6e", color4: "#74b9ff", color5: "#9b59b6" },
};

/** The swatches on the settings rows (BibleParamsModal). */
export const LIGHT_THEMES: { id: LightTheme; label: string; swatch: string }[] = [
  { id: "default", label: "White", swatch: "rgb(255,255,255)" }, { id: "sepia", label: "Sepia", swatch: "rgb(245,242,227)" }, { id: "nature", label: "Nature", swatch: "#EAF9EC" }, { id: "sunset", label: "Sunset", swatch: "#FAE0D5" },
];
export const DARK_THEMES: { id: DarkTheme; label: string; swatch: string }[] = [
  { id: "dark", label: "Dark", swatch: "rgb(18,45,66)" }, { id: "black", label: "Black", swatch: "black" }, { id: "mauve", label: "Mauve", swatch: "rgb(51,4,46)" }, { id: "night", label: "Night blue", swatch: "rgb(0,50,100)" },
];

export const isDarkTheme = (t: ThemeName) => t === "dark" || t === "black" || t === "night" || t === "mauve";

/** Highlight backgrounds sit at 90% over the page (HIGHLIGHT_BACKGROUND_OPACITY). */
export const HIGHLIGHT_BACKGROUND_OPACITY = 90;
export function convertHex(hex: string, opacity: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16), g = parseInt(h.substring(2, 4), 16), b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${opacity / 100})`;
}
const luminance = (hex: string) => { const h = hex.replace("#", ""); const r = parseInt(h.substring(0, 2), 16) / 255, g = parseInt(h.substring(2, 4), 16) / 255, b = parseInt(h.substring(4, 6), 16) / 255; return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
/** White on a dark wash, black on a light one, else the page's own ink (getContrastTextColor). */
export function contrastText(hex: string, dark: boolean): string | undefined {
  const l = luminance(hex);
  if (dark) { if (l > 0.5) return "#000000"; } else if (l < 0.6) return "#FFFFFF";
  return undefined;
}

/** CSS custom properties for a palette, `--bs-<token>`, applied on the Bible tab's root. */
export function cssVars(p: Palette): Record<string, string> {
  return Object.fromEntries(Object.entries(p).map(([k, v]) => [`--bs-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, v]));
}
