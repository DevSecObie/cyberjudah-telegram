import { useNavigate } from "react-router";
import { useState, type ReactNode } from "react";

import { haptic } from "@/tg/sdk";
import { Feather, LineHeightIcon, PressIcon, type FeatherName } from "../icons";
import { FONTS, webFontFamily, type BibleSettings } from "../settings";
import { DARK_THEMES, LIGHT_THEMES, type Palette, type ThemeName } from "../theme";
import { versesContent } from "../store";
import { Sheet, Switch } from "./Sheet";
import { ColorPaletteSheet } from "./ColorPalette";

/**
 * "Font and settings" (BibleParamsModal): one row per setting, its value in bold beside the
 * label and the controls on the right; then Fonts, Color palette and Share options, which
 * open their own sheets. Every label and choice is Bible Strong's.
 */
export function ParamsSheet({ open, onClose, settings: s, set, palette, theme }: { open: boolean; onClose: () => void; settings: BibleSettings; set: (p: Partial<BibleSettings>) => void; palette: Palette; theme: ThemeName }) {
  const navigate = useNavigate();
  const [sub, setSub] = useState<"fonts" | "palette" | "share" | null>(null);
  const align = { left: "Left", justify: "Justified" }[s.alignContent];
  const lh = { normal: "Normal", small: "Small", large: "Large" }[s.lineHeight];
  const td = { inline: "Inline", block: "Line break" }[s.textDisplay];
  const scheme = { light: "Day", dark: "Night", auto: "Auto" }[s.preferredColorScheme];
  const rd = { inline: "Chips under the verse", block: "One badge per verse" }[s.relationsDisplay];
  const tg = { inline: "Line break", block: "With icon" }[s.tagsDisplay];
  const press = { shortPress: "Short press", longPress: "Long press" }[s.press];
  return (
    <>
      <Sheet open={open} onClose={onClose} snapPoints={[0.4, 1]} label="Font and settings">
        <div className="bs-params">
          <Row label="Theme" value={scheme}>
            <IconBtn name="sun" label="Day" selected={s.preferredColorScheme === "light"} onPress={() => set({ preferredColorScheme: "light" })} />
            <IconBtn name="moon" label="Night" selected={s.preferredColorScheme === "dark"} onPress={() => set({ preferredColorScheme: "dark" })} />
            <IconBtn name="sunrise" label="Auto" selected={s.preferredColorScheme === "auto"} onPress={() => set({ preferredColorScheme: "auto" })} />
          </Row>
          <Row label="Day Color" value={LIGHT_THEMES.find((t) => t.id === s.preferredLightTheme)?.label}>
            {LIGHT_THEMES.map((t) => <ThemeCircle key={t.id} label={t.label} color={t.swatch} selected={s.preferredLightTheme === t.id} onPress={() => set({ preferredLightTheme: t.id })} />)}
          </Row>
          <Row label="Night Color" value={DARK_THEMES.find((t) => t.id === s.preferredDarkTheme)?.label}>
            {DARK_THEMES.map((t) => <ThemeCircle key={t.id} label={t.label} color={t.swatch} selected={s.preferredDarkTheme === t.id} onPress={() => set({ preferredDarkTheme: t.id })} />)}
          </Row>
          <Row label="Text size" value={`${100 + s.fontSizeScale * 10}%`}>
            <IconBtn name="type" size={15} label="Decrease text size" onPress={() => set({ fontSizeScale: Math.max(-5, s.fontSizeScale - 1) })} />
            <IconBtn name="type" label="Increase text size" onPress={() => set({ fontSizeScale: Math.min(5, s.fontSizeScale + 1) })} />
          </Row>
          <Row label="Text alignment" value={align} valueGap>
            <IconBtn name={s.alignContent === "left" ? "align-left" : "align-justify"} label={`Text alignment: ${align}`} selected onPress={() => set({ alignContent: s.alignContent === "left" ? "justify" : "left" })} />
          </Row>
          <Row label="Line height" value={lh} valueGap>
            <button type="button" className="bs-touchicon" aria-label={`Line height: ${lh}`} title={`Line height: ${lh}`} onClick={() => { haptic("select"); set({ lineHeight: ({ small: "normal", normal: "large", large: "small" } as const)[s.lineHeight] }); }}><LineHeightIcon gap={s.lineHeight === "small" ? 1 : s.lineHeight === "normal" ? 2 : 4} color="var(--bs-primary)" /></button>
          </Row>
          <Row label="Verse mode" value={td}>
            <IconBtn name={s.textDisplay === "inline" ? "arrow-right" : "corner-down-right"} label={`Verse mode: ${td}`} selected onPress={() => set({ textDisplay: s.textDisplay === "inline" ? "block" : "inline" })} />
          </Row>
          <Switch label="Verse numbers" on={s.showVerseNumbers} onChange={showVerseNumbers => set({ showVerseNumbers })} />
          <Row label="Precepts display" value={rd}>
            <IconBtn name={s.relationsDisplay === "inline" ? "align-left" : "precepts"} label={`Precepts display: ${rd}`} selected onPress={() => set({ relationsDisplay: s.relationsDisplay === "inline" ? "block" : "inline" })} />
          </Row>
          <Row label="Tags display" value={tg}>
            <IconBtn name={s.tagsDisplay === "inline" ? "align-left" : "tag"} label={`Tags display: ${tg}`} selected onPress={() => set({ tagsDisplay: s.tagsDisplay === "inline" ? "block" : "inline" })} />
          </Row>
          <Row label="Showing strongs" value={press}>
            <button type="button" className="bs-touchicon" aria-label={`Showing strongs: ${press}`} title={`Showing strongs: ${press}`} onClick={() => { haptic("select"); set({ press: s.press === "shortPress" ? "longPress" : "shortPress" }); }}><PressIcon long={s.press === "longPress"} color="var(--bs-primary)" /></button>
          </Row>
          <LinkRow label="Study resources" onPress={() => { onClose(); navigate("/resources"); }} />
          <LinkRow label="Fonts" value={<span style={{ fontFamily: webFontFamily(s.fontFamily) }}>{s.fontFamily}</span>} onPress={() => setSub("fonts")} />
          <LinkRow label="Color palette" onPress={() => setSub("palette")} />
          <LinkRow label="Share options" onPress={() => setSub("share")} />
        </div>
      </Sheet>
      <Sheet open={open && sub === "fonts"} onClose={() => setSub(null)} title="Fonts">
        <div className="bs-fontlist">
          {FONTS.map((f) => (
            <button key={f} type="button" role="radio" aria-checked={f === s.fontFamily} className="bs-fontrow" onClick={() => { set({ fontFamily: f }); setSub(null); }}>
              <span style={{ fontFamily: webFontFamily(f), fontSize: 18, color: f === s.fontFamily ? "var(--bs-primary)" : "var(--bs-default)" }}>{f}</span>
              {f === s.fontFamily ? <Feather name="check" size={20} color="var(--bs-primary)" /> : null}
            </button>
          ))}
        </div>
      </Sheet>
      <ColorPaletteSheet open={open && sub === "palette"} onClose={() => setSub(null)} settings={s} set={set} palette={palette} theme={theme} />
      <Sheet open={open && sub === "share"} onClose={() => setSub(null)} title="Share options">
        <ShareOptions settings={s} set={set} />
      </Sheet>
    </>
  );
}

function Row({ label, value, valueGap, children }: { label: string; value?: ReactNode; valueGap?: boolean; children: ReactNode }) {
  return <div className="bs-params__row" data-testid="bible-params-row"><span className="bs-params__label">{label}</span><b className="bs-params__value" style={valueGap ? { marginRight: 10 } : undefined}>{value}</b>{children}</div>;
}
function LinkRow({ label, value, onPress }: { label: string; value?: ReactNode; onPress: () => void }) {
  return <button type="button" className="bs-params__row bs-params__link" onClick={onPress}><span className="bs-params__label">{label}</span>{value ? <span className="bs-params__fontname">{value}</span> : null}<Feather name="chevron-right" size={20} color="var(--bs-grey)" /></button>;
}
/** TouchableIcon: a 30 px pill on lightPrimary, the icon primary when selected. */
function IconBtn({ name, label, selected, onPress, size = 17 }: { name: FeatherName; label: string; selected?: boolean; onPress: () => void; size?: number }) {
  return <button type="button" className="bs-touchicon" aria-label={label} title={label} aria-pressed={selected} onClick={() => { haptic("select"); onPress(); }}><Feather name={name} size={size} color={selected ? "var(--bs-primary)" : "var(--bs-primary)"} style={{ opacity: selected === false ? 0.45 : 1 }} /></button>;
}
function ThemeCircle({ label, color, selected, onPress }: { label: string; color: string; selected: boolean; onPress: () => void }) {
  return <button type="button" role="radio" aria-checked={selected} aria-label={label} title={label} className="bs-themecircle" onClick={() => { haptic("select"); onPress(); }}><span style={{ width: 20, height: 20, borderRadius: 20 / 3, background: color, boxShadow: selected ? "0 0 0 3px var(--bs-reverse), 0 0 0 5px var(--bs-primary)" : "inset 0 0 0 1px rgba(0,0,0,.15)" }} /></button>;
}

/** Share options: the four switches and a preview of Genesis 1:1-2 in that shape. */
function ShareOptions({ settings: s, set }: { settings: BibleSettings; set: (p: Partial<BibleSettings>) => void }) {
  const o = s.shareVerses;
  const toggle = (k: keyof typeof o) => set({ shareVerses: { ...o, [k]: !o[k] } });
  const preview = versesContent([{ verse: 1, text: "In the beginning God created the heaven and the earth." }, { verse: 2, text: "And the earth was without form, and void; and darkness was upon the face of the deep. And the Spirit of God moved upon the face of the waters." }], "Genesis 1:1-2", o).all;
  return (
    <div className="bs-shareopts">
      <Switch label="Verse numbers" on={o.hasVerseNumbers} onChange={() => toggle("hasVerseNumbers")} />
      <Switch label="Continuous text" on={o.hasInlineVerses} onChange={() => toggle("hasInlineVerses")} />
      <Switch label="Quotation marks" on={o.hasQuotes} onChange={() => toggle("hasQuotes")} />
      <Switch label="CyberJudah signature" on={o.hasAppName} onChange={() => toggle("hasAppName")} />
      <div className="bs-preview"><span className="bs-preview__label">Preview</span><p style={{ fontFamily: webFontFamily(s.fontFamily) }}>{preview}</p></div>
    </div>
  );
}
