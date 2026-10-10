import { useState } from "react";

import { Feather } from "../icons";
import type { MarkKind } from "../annotation/highlights";
import { colourName, type ColorItem } from "./SelectedVersesSheet";
import { Sheet } from "./Sheet";

/**
 * Bible Strong's AnnotationToolbar (features/bible/AnnotationToolbar.tsx), the sheet that stays
 * open through annotation mode (closing it leaves the mode). Its header names the selected mark's
 * passage, the selection's, or asks for a selection, with a delete button while either exists.
 * Then the three kinds (highlight, underline, circle) as AnnotationPreview's ink strokes, the
 * colours and "+" (the colour picker), and Note, Tags, Relations for the selected mark. Choosing a
 * kind only arms it; a colour applies it: to the selection as a new mark, or to the selected mark.
 */
export type ToolbarMark = { id: string; kind: MarkKind; color: string; hex: string; hasNote: boolean; tagsCount: number; relationsCount: number };
const KINDS: { kind: MarkKind; label: string }[] = [{ kind: "background", label: "Highlight" }, { kind: "underline", label: "Underline" }, { kind: "circle", label: "Circle" }];

/** AnnotationMark: the scalable ink stroke for each kind, on a 200 × 60 box. */
export function AnnotationMark({ kind, color }: { kind: MarkKind; color: string }) {
  return (
    <svg width="100%" height="100%" viewBox="0 0 200 60" preserveAspectRatio="none" aria-hidden="true">
      {kind === "background" ? <path d="M8 13 L44 10 L83 12 L124 9 L164 11 L193 9 L190 19 L196 25 L192 35 L195 47 L150 49 L109 47 L67 51 L29 48 L5 50 L8 38 L4 30 L9 22 Z" fill={color} fillOpacity={0.35} />
        : kind === "circle" ? <path d="M154 8 C112 0 39 3 14 20 C-7 35 19 52 66 55 C120 61 185 51 192 34 C204 12 148 1 92 5 M18 43 C49 59 125 58 172 47" fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
        : <path d="M10 50 Q92 53 190 49" fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" />}
    </svg>
  );
}
/** AnnotationPreview: "Aa" over the stroke, in a 68 × 30 box. */
export function AnnotationPreview({ kind, color }: { kind: MarkKind; color: string }) {
  return <span className="bs-annotate__preview"><span className="bs-annotate__ink"><AnnotationMark kind={kind} color={color} /></span><b>Aa</b></span>;
}

export function AnnotationToolbar(p: {
  open: boolean; enabled: boolean; reference: string | null; hasSelection: boolean; selected: ToolbarMark | null; colors: ColorItem[];
  onApply: (color: string, kind: MarkKind) => void; onChangeMark: (color: string, kind: MarkKind) => void;
  onErase: () => void; onDelete: () => void; onClose: () => void; onPickColor: (apply: (color: string) => void) => void;
  onNote: () => void; onTags: () => void; onRelations: () => void;
}) {
  const sel = p.selected;
  const disabled = !p.enabled || (!sel && !p.hasSelection);
  const markDisabled = !p.enabled || !sel;
  // The armed kind belongs to the selected mark: choosing another mark starts again from its kind.
  const [armed, setArmed] = useState<{ id?: string; kind: MarkKind }>({ id: sel?.id, kind: sel?.kind ?? "background" });
  const active = armed.id === sel?.id ? armed.kind : sel?.kind ?? "background";
  const colorFor = (kind: MarkKind) => (sel?.kind === kind ? sel.hex : "var(--bs-grey)");
  const apply = (color: string, kind: MarkKind) => (sel ? p.onChangeMark(color, kind) : p.onApply(color, kind));
  const selectedColor = sel?.kind === active ? sel.color : undefined;
  return (
    <Sheet open={p.open} onClose={p.onClose} backdrop={false} closable={false} label="Free mode" className="bs-annotate">
      <div className="bs-annotate__head">
        <div className="bs-annotate__title">
          <strong>Free mode</strong>
          <span>{p.reference ?? "Select text in the Bible"}</span>
        </div>
        {sel || p.hasSelection ? (
          <button type="button" className="bs-annotate__erase" aria-label="Delete" title="Delete" onClick={sel ? p.onDelete : p.onErase}>
            <Feather name="trash-2" size={20} color="var(--bs-quart)" />
          </button>
        ) : null}
      </div>
      <div className="bs-annotate__kinds" role="radiogroup" aria-label="Kind of mark">
        {KINDS.map((k) => (
          <button key={k.kind} type="button" role="radio" aria-checked={!disabled && active === k.kind} aria-label={k.label} disabled={disabled} className="bs-annotate__kind" data-on={!disabled && active === k.kind ? "" : undefined} onClick={() => setArmed({ id: sel?.id, kind: k.kind })}>
            <AnnotationPreview kind={k.kind} color={colorFor(k.kind)} />
            <span className="bs-annotate__label">{k.label}</span>
          </button>
        ))}
      </div>
      <div className="bs-annotate__colors" role="group" aria-label="Mark colour">
        {p.colors.map((c, i) => (
          <button key={c.key} type="button" className="bs-annotate__color" data-on={selectedColor === c.key ? "" : undefined} aria-pressed={selectedColor === c.key}
            aria-label={`${KINDS.find((k) => k.kind === active)!.label} in ${c.name || colourName(c.hex) || `colour ${i + 1}`}`} onClick={() => apply(c.key, active)}>
            <span style={{ background: c.hex }} />
          </button>
        ))}
        <button type="button" className="bs-annotate__more" aria-label="More colours" title="More colours" onClick={() => p.onPickColor((color) => apply(color, active))}>
          <Feather name="plus" size={16} color="var(--bs-primary)" />
        </button>
      </div>
      <div className="bs-annotate__links">
        <button type="button" disabled={markDisabled} onClick={p.onNote} aria-label="Note">
          <Feather name={sel?.hasNote ? "file-text" : "file-plus"} size={20} color={sel?.hasNote ? "var(--bs-primary)" : "var(--bs-grey)"} /><span>Note</span>
        </button>
        <i aria-hidden="true" />
        <button type="button" disabled={markDisabled} onClick={p.onTags} aria-label={`Tags, ${sel?.tagsCount ?? 0}`}>
          <Feather name="tag" size={20} color={sel?.tagsCount ? "var(--bs-primary)" : "var(--bs-grey)"} /><span>Tags</span>
          {sel?.tagsCount ? <b className="bs-annotate__count">{sel.tagsCount}</b> : null}
        </button>
        <i aria-hidden="true" />
        <button type="button" disabled={markDisabled} onClick={p.onRelations} aria-label={`Relations, ${sel?.relationsCount ?? 0}`}>
          <Feather name="git-merge" size={20} color={sel?.relationsCount ? "var(--bs-primary)" : "var(--bs-grey)"} /><span>Relations</span>
          {sel?.relationsCount ? <b className="bs-annotate__count">{sel.relationsCount}</b> : null}
        </button>
      </div>
    </Sheet>
  );
}
