import { useEffect } from "react";

import { useStored, useTheme } from "@/tg/hooks";
import { app } from "@/tg/sdk";

export type Theme = "dark" | "sepia" | "light" | "system";
export type Font = "serif" | "sans";
export type Spacing = "tight" | "regular" | "airy";

/** Applies the reader's theme, face and spacing to the document (mounted once in App). */
export function ThemeApplier() {
  const [theme] = useStored<Theme>("theme", "system");
  const { scheme } = useTheme();
  const [font] = useStored<Font>("font", "serif");
  const [spacing] = useStored<Spacing>("spacing", "regular");
  const [justify] = useStored("justify", false);
  const [transparency] = useStored<"system" | "reduced">("transparency", "system");
  useEffect(() => {
    const root = document.documentElement;
    if (transparency === "reduced") root.dataset.transparency = "reduced"; else delete root.dataset.transparency;
    try { localStorage.setItem("cj:transparency", transparency); } catch { /* private mode */ }
  }, [transparency]);
  useEffect(() => {
    const root = document.documentElement;
    const resolved = theme === "system" ? scheme : theme;
    // Remembered for the first paint of the next launch (index.html).
    try { localStorage.setItem("cj:theme-pref", theme); } catch { /* private mode */ }
    root.dataset.theme = resolved; root.dataset.font = font; root.dataset.spacing = spacing; root.dataset.justify = justify ? "yes" : "no";
    root.style.colorScheme = resolved === "dark" ? "dark" : "light";
    const bg = getComputedStyle(root).getPropertyValue("--canvas").trim() || "#05070f";
    if (app && app.isVersionAtLeast("6.1")) { app.setHeaderColor(bg); app.setBackgroundColor(bg); }
    if (app && app.isVersionAtLeast("7.10")) app.setBottomBarColor(bg);
  }, [theme, scheme, font, spacing, justify]);
  return null;
}
