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
  useEffect(() => {
    const root = document.documentElement;
    const resolved = theme === "system" ? scheme : theme;
    root.dataset.theme = resolved; root.dataset.font = font; root.dataset.spacing = spacing; root.dataset.justify = justify ? "yes" : "no";
    root.style.colorScheme = resolved === "dark" ? "dark" : "light";
    const bg = getComputedStyle(root).getPropertyValue("--color-void").trim() || "#05070f";
    if (app && app.isVersionAtLeast("6.1")) { app.setHeaderColor(bg); app.setBackgroundColor(bg); }
    if (app && app.isVersionAtLeast("7.10")) app.setBottomBarColor(bg);
  }, [theme, scheme, font, spacing, justify]);
  return null;
}
