import { useNavigate } from "react-router";
import { useState, type ReactNode } from "react";

import { haptic } from "@/tg/sdk";
import { Feather, LineHeightIcon, PressIcon, type FeatherName } from "../icons";
import { colorItems, DEFAULT_COLOR_KEYS, FONTS, MAX_CUSTOM_COLORS, webFontFamily, type BibleSettings, type DefaultColorKey, type HighlightType } from "../settings";
import { DARK_THEMES, LIGHT_THEMES, type Palette } from "../theme";
import { uuid, versesContent } from "../store";
import { Button, Sheet, Switch } from "./Sheet";
import { HighlightTypeIndicator } from "./SelectedVersesSheet";

/**
 * "Font and settings" (BibleParamsModal): one row per setting, its value in bold beside the
 * label and the controls on the right; then Fonts, Color palette and Share options, which
 * open their own sheets. Every label and choice is Bible Strong's.
 */
export function ParamsSheet({ open, onClose, settings: s, set, palette }: { open: boolean; onClose: () => void; settings: BibleSettings; set: (p: Partial<BibleSettings>) => void; palette: Palette }) {
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
      <Sheet open={open && !sub} onClose={onClose} height="full" label="Font and settings">
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
      <Sheet open={open && sub === "fonts"} onClose={() => setSub(null)} title="Fonts" hasBack onBack={() => setSub(null)}>
        <div className="bs-fontlist">
          {FONTS.map((f) => (
            <button key={f} type="button" role="radio" aria-checked={f === s.fontFamily} className="bs-fontrow" onClick={() => { set({ fontFamily: f }); setSub(null); }}>
              <span style={{ fontFamily: webFontFamily(f), fontSize: 18, color: f === s.fontFamily ? "var(--bs-primary)" : "var(--bs-default)" }}>{f}</span>
              {f === s.fontFamily ? <Feather name="check" size={20} color="var(--bs-primary)" /> : null}
            </button>
          ))}
        </div>
      </Sheet>
      <PaletteSheet open={open && sub === "palette"} onClose={() => setSub(null)} settings={s} set={set} palette={palette} />
      <Sheet open={open && sub === "share"} onClose={() => setSub(null)} title="Share options" hasBack onBack={() => setSub(null)}>
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

/** Color palette: the five default colours and the custom ones, each editable (hex, name, type). */
/** With `onSelect` it is Bible Strong's colour picker (ColorPickerModal): a row picks its colour, its pencil edits it. */
export function PaletteSheet({ open, onClose, settings: s, set, palette, editing: startEditing, onSelect }: { open: boolean; onClose: () => void; settings: BibleSettings; set: (p: Partial<BibleSettings>) => void; palette: Palette; editing?: string | null; onSelect?: (key: string) => void }) {
  const items = colorItems(s, palette);
  const [editing, setEditing] = useState<string | null>(startEditing ?? null);
  const item = items.find((c) => c.key === editing);
  const save = (key: string, hex: string, name: string, type: HighlightType) => {
    if (DEFAULT_COLOR_KEYS.includes(key as DefaultColorKey)) {
      const k = key as DefaultColorKey;
      set({ colors: { ...s.colors, [k]: hex }, defaultColorNames: { ...s.defaultColorNames, [k]: name || undefined }, defaultColorTypes: { ...s.defaultColorTypes, [k]: type } });
    } else set({ customHighlightColors: s.customHighlightColors.map((c) => (c.id === key ? { ...c, hex, name: name || undefined, type } : c)) });
    setEditing(null);
  };
  const add = () => { if (s.customHighlightColors.length >= MAX_CUSTOM_COLORS) return; const id = `custom-${uuid()}`; set({ customHighlightColors: [...s.customHighlightColors, { id, hex: "#ff7675", type: "background" }] }); setEditing(id); };
  const remove = (id: string) => { set({ customHighlightColors: s.customHighlightColors.filter((c) => c.id !== id) }); setEditing(null); };
  return (
    <>
      <Sheet open={open && !item} onClose={onClose} title="Color palette" hasBack onBack={onClose}>
        <div className="bs-palette">
          {items.map((c, i) => {
            const name = c.name || (c.key.startsWith("color") ? `Color ${i + 1}` : "Custom color");
            return onSelect ? (
              <div key={c.key} className="bs-palette__row">
                <button type="button" className="bs-palette__pick" onClick={() => onSelect(c.key)}>
                  <HighlightTypeIndicator color={c.hex} type={c.type} size={26} />
                  <span className="bs-palette__name">{name}</span>
                  <small>{c.hex}</small>
                </button>
                <button type="button" className="bs-iconbtn" aria-label={`Edit ${name}`} title={`Edit ${name}`} onClick={() => setEditing(c.key)}><Feather name="edit-2" size={18} color="var(--bs-grey)" /></button>
              </div>
            ) : (
              <button key={c.key} type="button" className="bs-palette__row" onClick={() => setEditing(c.key)}>
                <HighlightTypeIndicator color={c.hex} type={c.type} size={26} />
                <span className="bs-palette__name">{name}</span>
                <small>{c.hex}</small>
                <Feather name="chevron-right" size={18} color="var(--bs-grey)" />
              </button>
            );
          })}
          {s.customHighlightColors.length < MAX_CUSTOM_COLORS ? <button type="button" className="bs-palette__row" onClick={add}><span className="bs-palette__plus"><Feather name="plus" size={18} color="var(--bs-primary)" /></span><span className="bs-palette__name">Add a color</span></button> : null}
        </div>
      </Sheet>
      {item ? <ColorEditSheet open={open} initial={item} onClose={() => setEditing(null)} onSave={(hex, name, type) => save(item.key, hex, name, type)} onRemove={item.key.startsWith("custom-") ? () => remove(item.key) : undefined} /> : null}
    </>
  );
}

/** ColorEditModal: the colour, its name and its type (Highlight, Text color, Underline). */
export function ColorEditSheet({ open, initial, onClose, onSave, onRemove }: { open: boolean; initial: { hex: string; name?: string; type: HighlightType }; onClose: () => void; onSave: (hex: string, name: string, type: HighlightType) => void; onRemove?: () => void }) {
  const [hex, setHex] = useState(initial.hex);
  const [name, setName] = useState(initial.name ?? "");
  const [type, setType] = useState<HighlightType>(initial.type);
  const PRESETS = ["#81ecec", "#ff7675", "#fdcb6e", "#74b9ff", "#95afc0", "#9b59b6", "#55efc4", "#fab1a0", "#ffeaa7", "#a29bfe", "#fd79a8", "#e17055", "#00b894", "#0984e3", "#d63031", "#636e72"];
  return (
    <Sheet open={open} onClose={onClose} title="Edit color" hasBack onBack={onClose} footer={<div className="bs-sheet__actions">{onRemove ? <Button reverse onClick={onRemove}>Remove</Button> : null}<Button onClick={() => onSave(hex, name.trim(), type)}>Save</Button></div>}>
      <div className="bs-coloredit">
        <div className="bs-coloredit__head"><HighlightTypeIndicator color={hex} type={type} size={34} /><input className="bs-input" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={30} aria-label="Name" /></div>
        <div className="bs-coloredit__grid">{PRESETS.map((c) => <button key={c} type="button" aria-label={c} title={c} aria-pressed={hex.toLowerCase() === c} style={{ background: c, boxShadow: hex.toLowerCase() === c ? "0 0 0 3px var(--bs-reverse), 0 0 0 5px var(--bs-primary)" : undefined }} onClick={() => setHex(c)} />)}</div>
        <label className="bs-coloredit__hex">Color <input type="color" value={/^#[0-9a-f]{6}$/i.test(hex) ? hex : "#ff7675"} onChange={(e) => setHex(e.target.value)} /><span>{hex}</span></label>
        <div className="bs-coloredit__types" role="radiogroup" aria-label="Type">
          {([["background", "Highlight"], ["textColor", "Text color"], ["underline", "Underline"]] as const).map(([t, l]) => <button key={t} type="button" role="radio" aria-checked={type === t} onClick={() => setType(t)}><HighlightTypeIndicator color={hex} type={t} size={22} isSelected={type === t} /><span>{l}</span></button>)}
        </div>
      </div>
    </Sheet>
  );
}
