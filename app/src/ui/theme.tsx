import { useEffect } from "react";

import { useStored, useTheme } from "@/tg/hooks";
import { app } from "@/tg/sdk";
import { paletteOf, resolveTheme, useBibleSettings, type BibleSettings } from "@/bible/settings";
import { isDarkTheme, type ThemeName } from "@/bible/theme";
import { appVars, withTelegramAccent } from "./palette";

export type Font = "serif" | "sans";
export type Spacing = "tight" | "regular" | "airy";

/**
 * The reader's theme in force (the Bible's day or night colour), and whether it is dark. Until
 * the saved settings arrive, `loaded` is false and the page keeps what index.html painted.
 */
export function useAppTheme(): { name: ThemeName; dark: boolean; loaded: boolean } {
  const [bible] = useBibleSettings();
  const [, , loaded] = useStored<object>("bs", {});
  const { scheme } = useTheme();
  const name = resolveTheme(bible, scheme);
  const dark = loaded ? isDarkTheme(name) : document.documentElement.dataset.theme !== "light";
  return { name, dark, loaded };
}

/**
 * Applies the reader's colours, face and spacing to the whole document (mounted once in App):
 * one theme, chosen in the Bible or in Settings, for every screen.
 */
export function ThemeApplier() {
  const [bible] = useBibleSettings();
  const { name, dark, loaded } = useAppTheme();
  const [font] = useStored<Font>("font", "serif");
  const [spacing] = useStored<Spacing>("spacing", "regular");
  const [justify] = useStored("justify", false);
  const [transparency] = useStored<"system" | "reduced">("transparency", "system");
  useEffect(() => {
    const root = document.documentElement;
    if (transparency === "reduced") root.dataset.transparency = "reduced"; else delete root.dataset.transparency;
    try { localStorage.setItem("cj:transparency", transparency); } catch { /* private mode */ }
  }, [transparency]);
  // Until the reader picks a theme of their own, the accent is Telegram's (its theme params).
  const [stored] = useStored<Partial<BibleSettings>>("bs", {});
  const { params } = useTheme();
  const picked = !!(stored.preferredLightTheme || stored.preferredDarkTheme);
  const palette = paletteOf(name, bible);
  const vars = withTelegramAccent(appVars(palette, dark), picked ? undefined : params.accent_text_color || params.button_color, palette, dark);
  const key = JSON.stringify(vars);
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.font = font; root.dataset.spacing = spacing; root.dataset.justify = justify ? "yes" : "no";
    // The colours wait for the saved theme, so a Nature or Sepia reader never sees a flash of another.
    if (!loaded) return;
    const mode = dark ? "dark" : "light";
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    root.dataset.theme = mode; root.dataset.palette = name;
    root.style.colorScheme = mode;
    // Remembered for the first paint of the next launch (index.html).
    try { localStorage.setItem("cj:theme-pref", mode); localStorage.setItem("cj:palette", key); } catch { /* private mode */ }
    const bg = vars["--canvas"];
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", bg);
    if (app && app.isVersionAtLeast("6.1")) { app.setHeaderColor(bg); app.setBackgroundColor(bg); }
    if (app && app.isVersionAtLeast("7.10")) app.setBottomBarColor(bg);
  }, [key, name, dark, loaded, font, spacing, justify]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
