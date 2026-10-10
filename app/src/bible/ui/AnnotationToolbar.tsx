import { useState } from "react";

import { haptic } from "@/tg/sdk";
import type { Annotation } from "@/studies/storage";
import { Feather } from "../icons";
import { colourName, type ColorItem } from "./SelectedVersesSheet";
import { Sheet } from "./Sheet";

/**
 * Bible Strong's AnnotationToolbar (features/bible/AnnotationToolbar.tsx) for the words selected by
 * a double tap: the title and the passage, the eraser, the three kinds of mark (highlight,
 * underline, circle) drawn as AnnotationPreview's ink strokes, and the colour palette. Choosing a
 * colour marks the selection in the chosen kind and ends it. No backdrop: the text stays live, so
 * the handles can still be dragged.
 */
export type MarkStyle = Annotation["style"];
const KINDS: { style: MarkStyle; label: string }[] = [{ style: "highlight", label: "Highlight" }, { style: "underline", label: "Underline" }, { style: "circle", label: "Circle" }];

/** AnnotationMark: the scalable ink stroke for each kind, on a 200 × 60 box. */
export function AnnotationMark({ style, color }: { style: MarkStyle; color: string }) {
  return (
    <svg width="100%" height="100%" viewBox="0 0 200 60" preserveAspectRatio="none" aria-hidden="true">
      {style === "highlight" ? <path d="M8 13 L44 10 L83 12 L124 9 L164 11 L193 9 L190 19 L196 25 L192 35 L195 47 L150 49 L109 47 L67 51 L29 48 L5 50 L8 38 L4 30 L9 22 Z" fill={color} fillOpacity={0.35} />
        : style === "circle" ? <path d="M154 8 C112 0 39 3 14 20 C-7 35 19 52 66 55 C120 61 185 51 192 34 C204 12 148 1 92 5 M18 43 C49 59 125 58 172 47" fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
        : <path d="M10 50 Q92 53 190 49" fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" />}
    </svg>
  );
}

export function AnnotationToolbar({ open, reference, colors, onApply, onErase, onClose }: {
  open: boolean; reference: string; colors: ColorItem[];
  onApply: (color: string, style: MarkStyle) => void; onErase: () => void; onClose: () => void;
}) {
  const [kind, setKind] = useState<MarkStyle>("highlight");
  return (
    <Sheet open={open} onClose={onClose} backdrop={false} closable={false} label={`Annotate: ${reference}`} className="bs-annotate">
      <div className="bs-annotate__head">
        <div className="bs-annotate__title">
          <strong>Annotate</strong>
          <span>{reference || "Select text in the Bible"}</span>
        </div>
        <button type="button" className="bs-annotate__erase" aria-label="Erase marks in the selection" title="Erase marks in the selection" onClick={() => { haptic("select"); onErase(); }}>
          <Feather name="trash-2" size={20} color="var(--bs-quart)" />
        </button>
      </div>
      <div className="bs-annotate__kinds" role="radiogroup" aria-label="Kind of mark">
        {KINDS.map((k) => (
          <button key={k.style} type="button" role="radio" aria-checked={kind === k.style} className="bs-annotate__kind" data-on={kind === k.style ? "" : undefined} onClick={() => setKind(k.style)}>
            <span className="bs-annotate__preview"><span className="bs-annotate__ink"><AnnotationMark style={k.style} color="var(--bs-grey)" /></span><b>Aa</b></span>
            <span className="bs-annotate__label">{k.label}</span>
          </button>
        ))}
      </div>
      <div className="bs-annotate__colors" role="group" aria-label="Mark colour">
        {colors.map((c, i) => (
          <button key={c.key} type="button" className="bs-annotate__color" aria-label={`${KINDS.find((k) => k.style === kind)!.label} in ${c.name || colourName(c.hex) || `colour ${i + 1}`}`}
            onClick={() => { haptic("success"); onApply(c.key, kind); }}>
            <span style={{ background: c.hex }} />
          </button>
        ))}
      </div>
    </Sheet>
  );
}
