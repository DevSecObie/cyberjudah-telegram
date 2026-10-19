import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";

import { allAnnotations, changeAnnotations, markId } from "@/studies/storage";
import { confirm, haptic } from "@/tg/sdk";
import { json, store } from "@/tg/store";
import { Feather } from "../icons";
import { DEFAULT_COLOR_KEYS, MAX_CUSTOM_COLORS, type BibleSettings, type CustomColor, type DefaultColorKey, type HighlightType } from "../settings";
import type { Highlight } from "../store";
import { uuid } from "../store";
import { contrastText, convertHex, HIGHLIGHT_BACKGROUND_OPACITY, PALETTES, type Palette, type ThemeName } from "../theme";
import { HighlightTypeIndicator } from "./SelectedVersesSheet";
import { Button, Sheet } from "./Sheet";

/**
 * Bible Strong's colour palette (common/ColorPickerModal.tsx) and colour editor
 * (common/ColorEditModal.tsx), with its labels. The palette lists the five default colours and the
 * reader's own, each with how many highlights use it, a reset for a changed default and a gear to
 * edit it, then "Add a color". Opened from the circled arrow at the end of a colour row it is a
 * picker: tapping a colour hands it back and closes.
 */
export type PaletteRequest = { selectedColor?: string; onSelectColor?: (key: string) => void };
type Editing =
  | { mode: "add"; hex: string; name: string; type: HighlightType }
  | { mode: "edit-default"; key: DefaultColorKey; hex: string; name: string; type: HighlightType }
  | { mode: "edit-custom"; color: CustomColor; hex: string; name: string; type: HighlightType };

/** How many verse highlights and word marks use each colour, across every chapter. */
function useUsage(open: boolean) {
  const [usage, setUsage] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!open) return;
    let live = true;
    void (async () => {
      const out: Record<string, number> = {};
      const keys = (await store.keys()).filter((k) => k.startsWith("bs_h_"));
      for (const k of keys) for (const h of Object.values(await json.get<Record<string, Highlight>>(k, {}))) if (h.color) out[h.color] = (out[h.color] ?? 0) + 1;
      const marks = new Map<string, string>();
      for (const a of await allAnnotations().catch(() => [])) if (a.color) marks.set(markId(a), a.color);
      for (const c of marks.values()) out[c] = (out[c] ?? 0) + 1;
      if (live) setUsage(out);
    })();
    return () => { live = false; };
  }, [open]);
  return usage;
}

/** Removes every verse highlight and word mark in a colour, as Bible Strong does before deleting it. */
async function removeColorEverywhere(colorId: string) {
  for (const k of (await store.keys()).filter((x) => x.startsWith("bs_h_"))) {
    const hl = await json.get<Record<string, Highlight>>(k, {});
    let changed = false;
    for (const [v, h] of Object.entries(hl)) if (h.color === colorId) { changed = true; if (h.tags && Object.keys(h.tags).length) hl[v] = { ...h, color: "" }; else delete hl[v]; }
    if (changed) await json.set(k, hl);
  }
  const ids = (await allAnnotations().catch(() => [])).filter((a) => a.color === colorId).map((a) => a.id);
  if (ids.length) await changeAnnotations({ remove: ids });
}

export function ColorPaletteSheet({ open, request, onClose, settings: s, set, palette, theme }: {
  open: boolean; request?: PaletteRequest | null; onClose: () => void;
  settings: BibleSettings; set: (p: Partial<BibleSettings>) => void; palette: Palette; theme: ThemeName;
}) {
  const [editing, setEditing] = useState<Editing | null>(null);
  useEffect(() => { if (!open) setEditing(null); }, [open]);
  const usage = useUsage(open && !editing);
  const selecting = !!request?.onSelectColor;
  const select = (key: string) => { if (!request?.onSelectColor) return; haptic("select"); request.onSelectColor(key); onClose(); };
  const save = (e: Editing, hex: string, name: string | undefined, type: HighlightType) => {
    if (e.mode === "add") set({ customHighlightColors: [...s.customHighlightColors, { id: `custom-${uuid()}`, hex, name, type }] });
    else if (e.mode === "edit-default") set({ colors: { ...s.colors, [e.key]: hex }, defaultColorNames: { ...s.defaultColorNames, [e.key]: name }, defaultColorTypes: { ...s.defaultColorTypes, [e.key]: type } });
    else set({ customHighlightColors: s.customHighlightColors.map((c) => (c.id === e.color.id ? { ...c, hex, name, type } : c)) });
    setEditing(null);
  };
  const reset = (key: DefaultColorKey) => {
    const colors = { ...s.colors }; delete colors[key];
    const names = { ...s.defaultColorNames }; delete names[key];
    set({ colors, defaultColorTypes: { ...s.defaultColorTypes, [key]: "background" }, defaultColorNames: names });
  };
  const isModified = (key: DefaultColorKey) => {
    const original = PALETTES[theme][key];
    const type = s.defaultColorTypes[key];
    return palette[key] !== original || (!!type && type !== "background") || !!s.defaultColorNames[key];
  };
  const deleteCustom = async (c: CustomColor) => {
    const count = usage[c.id] ?? 0;
    if (count > 0) {
      if (!(await confirm(`Delete color\n\nThis color is used by ${count} highlight(s). They will also be deleted.`))) return;
      await removeColorEverywhere(c.id);
    }
    set({ customHighlightColors: s.customHighlightColors.filter((x) => x.id !== c.id) });
    setEditing(null);
  };
  const count = (key: string) => <span className="bs-palette__count">{usage[key] ?? 0} highlight(s)</span>;
  return (
    <>
      <Sheet open={open} onClose={onClose} title="Color palette" className="bs-palette-sheet">
        <div className="bs-palette">
          <h3 className="bs-palette__section">Default colors</h3>
          {DEFAULT_COLOR_KEYS.map((key, i) => {
            const hex = palette[key], type = s.defaultColorTypes[key] ?? "background", name = s.defaultColorNames[key] || `Color ${i + 1}`;
            return (
              <div key={key} className="bs-palette__row">
                <button type="button" className="bs-palette__pick" disabled={!selecting} aria-pressed={selecting ? request?.selectedColor === key : undefined} onClick={() => select(key)}>
                  <HighlightTypeIndicator color={hex} type={type} size={30} isSelected={request?.selectedColor === key} />
                  <b className="bs-palette__name">{name}</b>
                </button>
                {count(key)}
                {isModified(key) ? <button type="button" className="bs-palette__icon" aria-label={`Reset ${name}`} title={`Reset ${name}`} onClick={() => reset(key)}><Feather name="refresh-cw" size={14} color="var(--bs-grey)" /></button> : null}
                <button type="button" className="bs-palette__icon" aria-label={`Edit ${name}`} title={`Edit ${name}`} onClick={() => setEditing({ mode: "edit-default", key, hex, name, type })}><Feather name="settings" size={16} color="var(--bs-grey)" /></button>
              </div>
            );
          })}
          <h3 className="bs-palette__section">My colors</h3>
          {!s.customHighlightColors.length ? <p className="bs-palette__empty">No custom colors</p> : null}
          {s.customHighlightColors.map((c, i) => {
            const name = c.name || `Custom color ${i + 1}`;
            return (
              <div key={c.id} className="bs-palette__row">
                <button type="button" className="bs-palette__pick" disabled={!selecting} aria-pressed={selecting ? request?.selectedColor === c.id : undefined} onClick={() => select(c.id)}>
                  <HighlightTypeIndicator color={c.hex} type={c.type ?? "background"} size={30} isSelected={request?.selectedColor === c.id} />
                  <b className="bs-palette__name">{name}</b>
                </button>
                {count(c.id)}
                <button type="button" className="bs-palette__icon" aria-label={`Edit ${name}`} title={`Edit ${name}`} onClick={() => setEditing({ mode: "edit-custom", color: c, hex: c.hex, name, type: c.type ?? "background" })}><Feather name="settings" size={16} color="var(--bs-grey)" /></button>
              </div>
            );
          })}
          {s.customHighlightColors.length < MAX_CUSTOM_COLORS
            ? <button type="button" className="bs-palette__add" onClick={() => setEditing({ mode: "add", hex: "#ff7675", name: "", type: "background" })}><span className="bs-palette__plus"><Feather name="plus" size={20} color="var(--bs-primary)" /></span><b>Add a color</b></button>
            : <p className="bs-palette__limit">Limit of 20 custom colors reached</p>}
        </div>
      </Sheet>
      {editing ? <ColorEditSheet open={open} mode={editing.mode === "add" ? "add" : "edit"} initial={editing} onClose={() => setEditing(null)}
        onSave={(hex, name, type) => save(editing, hex, name, type)} onDelete={editing.mode === "edit-custom" ? () => void deleteCustom(editing.color) : undefined} /> : null}
    </>
  );
}

/** ColorEditModal: the colour on a picker, its name, its highlight type, a preview, Validate. */
export function ColorEditSheet({ open, mode, initial, titleName, onClose, onSave, onDelete, dark }: {
  open: boolean; mode: "add" | "edit"; initial: { hex: string; name?: string; type: HighlightType }; titleName?: string;
  onClose: () => void; onSave: (hex: string, name: string | undefined, type: HighlightType) => void; onDelete?: () => void; dark?: boolean;
}) {
  const [hex, setHex] = useState(initial.hex);
  const [name, setName] = useState(initial.name ?? "");
  const [type, setType] = useState<HighlightType>(initial.type);
  useEffect(() => { if (open) { setHex(toHex(initial.hex)); setName(initial.name ?? ""); setType(initial.type); } }, [open, initial.hex, initial.name, initial.type]);
  const isDark = dark ?? document.querySelector(".bs")?.hasAttribute("data-dark") ?? false;
  const sample = type === "background"
    ? { backgroundColor: convertHex(hex, HIGHLIGHT_BACKGROUND_OPACITY), borderRadius: 4, padding: "2px 4px", color: contrastText(hex, isDark) ?? "var(--bs-default)" }
    : type === "textColor" ? { color: hex } : { borderBottom: `4px solid ${hex}99` };
  const title = mode === "add" ? "New color" : `Edit ${titleName ?? initial.name ?? ""}`.trim();
  return (
    <Sheet open={open} onClose={onClose} title={title} label={title} className="bs-coloredit-sheet"
      right={onDelete ? <button type="button" className="bs-iconbtn" aria-label="Remove" title="Remove" onClick={onDelete}><Feather name="trash-2" size={16} color="var(--bs-quart)" /></button> : undefined}>
      <div className="bs-coloredit">
        <ColorPicker value={hex} onChange={setHex} />
        <input className="bs-coloredit__name" placeholder="Color name (optional)" aria-label="Color name (optional)" value={name} onChange={(e) => setName(e.target.value)} maxLength={30} />
        <div className="bs-coloredit__type">
          <span className="bs-coloredit__label">Highlight type</span>
          <div className="bs-coloredit__types" role="radiogroup" aria-label="Highlight type">
            {([["background", "Background"], ["textColor", "Text"], ["underline", "Underline"]] as const).map(([t, l]) => (
              <button key={t} type="button" role="radio" aria-checked={type === t} aria-label={l} onClick={() => setType(t)}>{l}</button>
            ))}
          </div>
          <div className="bs-coloredit__preview">
            <div><span className="bs-coloredit__label">Preview</span><span>{hex}</span></div>
            <span className="bs-coloredit__sample" style={sample}>Sample verse text</span>
          </div>
        </div>
        <Button onClick={() => { onSave(hex, name.trim() || undefined, type); onClose(); }}>Validate</Button>
      </div>
    </Sheet>
  );
}

/**
 * ColorPicker (reanimated-color-picker's Panel2 and BrightnessSlider, as Bible Strong lays them
 * out): a panel with the hue across and the saturation down, and a brightness bar under it.
 */
function ColorPicker({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const hsv = hexToHsv(value);
  const panel = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const drag = (el: HTMLDivElement | null, e: RPointerEvent, fn: (x: number, y: number) => void) => {
    if (!el) return;
    const r = el.getBoundingClientRect();
    fn(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)));
  };
  const onPanel = (e: RPointerEvent) => drag(panel.current, e, (x, y) => onChange(hsvToHex(x * 360, 1 - y, hsv.v || 1)));
  const onBar = (e: RPointerEvent) => drag(bar.current, e, (x) => onChange(hsvToHex(hsv.h, hsv.s, x)));
  const start = (fn: (e: RPointerEvent) => void) => (e: RPointerEvent) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); fn(e); };
  const move = (fn: (e: RPointerEvent) => void) => (e: RPointerEvent) => { if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) fn(e); };
  const full = hsvToHex(hsv.h, hsv.s, 1);
  return (
    <div className="bs-colorpicker">
      <div ref={panel} className="bs-colorpicker__panel" role="slider" aria-label="Hue and saturation" aria-valuenow={Math.round(hsv.h)} aria-valuemin={0} aria-valuemax={360} tabIndex={0}
        onKeyDown={(e) => { const d = e.key === "ArrowRight" ? 5 : e.key === "ArrowLeft" ? -5 : 0, ds = e.key === "ArrowUp" ? 0.05 : e.key === "ArrowDown" ? -0.05 : 0; if (!d && !ds) return; e.preventDefault(); onChange(hsvToHex((hsv.h + d + 360) % 360, Math.min(1, Math.max(0, hsv.s + ds)), hsv.v || 1)); }}
        onPointerDown={start(onPanel)} onPointerMove={move(onPanel)}>
        <span className="bs-colorpicker__thumb" style={{ left: `${(hsv.h / 360) * 100}%`, top: `${(1 - hsv.s) * 100}%`, background: full }} />
      </div>
      <div ref={bar} className="bs-colorpicker__bar" role="slider" aria-label="Brightness" aria-valuenow={Math.round(hsv.v * 100)} aria-valuemin={0} aria-valuemax={100} tabIndex={0} style={{ background: `linear-gradient(to right, #000, ${full})` }}
        onKeyDown={(e) => { const d = e.key === "ArrowRight" || e.key === "ArrowUp" ? 0.05 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -0.05 : 0; if (!d) return; e.preventDefault(); onChange(hsvToHex(hsv.h, hsv.s, Math.min(1, Math.max(0, hsv.v + d)))); }}
        onPointerDown={start(onBar)} onPointerMove={move(onBar)}>
        <span className="bs-colorpicker__thumb" style={{ left: `${hsv.v * 100}%`, top: "50%", background: value }} />
      </div>
    </div>
  );
}

/** Any CSS colour Bible Strong stores (#rgb, #rrggbb, rgb()) as #rrggbb. */
export function toHex(c: string): string {
  const m3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(c);
  if (m3) return `#${m3[1]}${m3[1]}${m3[2]}${m3[2]}${m3[3]}${m3[3]}`.toLowerCase();
  if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
  const m = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/i.exec(c);
  if (m) return `#${[m[1], m[2], m[3]].map((x) => Math.min(255, +x).toString(16).padStart(2, "0")).join("")}`;
  return "#ff0000";
}
function hexToHsv(c: string) {
  const h6 = toHex(c).slice(1);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h6.slice(i, i + 2), 16) / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: mx ? d / mx : 0, v: mx };
}
function hsvToHex(h: number, s: number, v: number) {
  const f = (n: number) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return `#${[f(5), f(3), f(1)].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("")}`;
}
