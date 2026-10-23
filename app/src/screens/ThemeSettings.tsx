import type { CSSProperties, ReactNode } from "react";
import { Feather, type FeatherName } from "@/bible/icons";
import { useBibleSettings } from "@/bible/settings";
import { cssVars, DARK_THEMES, LIGHT_THEMES, PALETTES } from "@/bible/theme";
import { haptic } from "@/tg/sdk";
import { useBackButton } from "@/tg/hooks";
import { useAppTheme } from "@/ui/theme";
import { Screen } from "@/ui/ui";

/**
 * Bible Strong's Theme screen (features/settings/ThemeScreen.tsx): three section cards on the
 * light-grey page, MODE with the sun, moon and sunrise icons, DAY COLOR and NIGHT COLOR with a
 * 28 px disc per palette, the chosen one ringed in primary.
 */
export function ThemeSettings() {
  useBackButton();
  const { name } = useAppTheme();
  const [s, set] = useBibleSettings();
  const scheme = { light: "Day", dark: "Night", auto: "Auto" }[s.preferredColorScheme];
  return (
    <Screen title="Theme" className="grouped bs-theme">
      <div style={cssVars(PALETTES[name]) as CSSProperties}>
        <Card icon="sun" title="Mode">
          <span className="bs-theme__value">{scheme}</span>
          <span className="bs-theme__icons">
            <ModeIcon name="sun" label="Day" selected={s.preferredColorScheme === "light"} onPress={() => set({ preferredColorScheme: "light" })} />
            <ModeIcon name="moon" label="Night" selected={s.preferredColorScheme === "dark"} onPress={() => set({ preferredColorScheme: "dark" })} />
            <ModeIcon name="sunrise" label="Auto" selected={s.preferredColorScheme === "auto"} onPress={() => set({ preferredColorScheme: "auto" })} />
          </span>
        </Card>
        <Card icon="sun" title="Day Color">
          <span className="bs-theme__value bs-theme__value--grow">{LIGHT_THEMES.find((t) => t.id === s.preferredLightTheme)?.label}</span>
          {LIGHT_THEMES.map((t) => <Disc key={t.id} label={t.label} color={t.swatch} selected={s.preferredLightTheme === t.id} onPress={() => set({ preferredLightTheme: t.id })} />)}
        </Card>
        <Card icon="moon" title="Night Color">
          <span className="bs-theme__value bs-theme__value--grow">{DARK_THEMES.find((t) => t.id === s.preferredDarkTheme)?.label}</span>
          {DARK_THEMES.map((t) => <Disc key={t.id} label={t.label} color={t.swatch} selected={s.preferredDarkTheme === t.id} onPress={() => set({ preferredDarkTheme: t.id })} />)}
        </Card>
      </div>
    </Screen>
  );
}

/** SectionCard with its SectionCardHeader, as on More (`.mcard`): a 16 px grey icon and a 12 px bold uppercase label. */
function Card({ icon, title, children }: { icon: FeatherName; title: string; children: ReactNode }) {
  return (
    <section className="mcard bs-theme__card" aria-label={title}>
      <h2 className="mcard__head"><Feather name={icon} size={16} />{title}</h2>
      <div className="bs-theme__row">{children}</div>
    </section>
  );
}

/** TouchableIcon: a 20 px Feather icon, tertiary, primary when selected. */
function ModeIcon({ name, label, selected, onPress }: { name: FeatherName; label: string; selected: boolean; onPress: () => void }) {
  return <button type="button" className="bs-theme__icon" aria-label={label} aria-pressed={selected} onClick={() => { haptic("select"); onPress(); }}><Feather name={name} size={20} color={selected ? "var(--bs-primary)" : "var(--bs-tertiary)"} /></button>;
}

/** Circle in a 40 px LinkBox: 28 px, a 2 px border in primary when selected, opacity5 otherwise. */
function Disc({ label, color, selected, onPress }: { label: string; color: string; selected: boolean; onPress: () => void }) {
  return <button type="button" role="radio" aria-checked={selected} aria-label={label} className="bs-theme__disc" onClick={() => { haptic("select"); onPress(); }}><span style={{ background: color, borderColor: selected ? "var(--bs-primary)" : "var(--bs-opacity5)" }} /></button>;
}
