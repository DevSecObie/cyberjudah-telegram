import { useEffect, useState, type CSSProperties } from "react";
import { subscribeStudies, verseAnnotations, type Annotation } from "./storage";
import "./studies.css";

export function useAnnotations(key: string) {
  const [annotations, setAnnotations] = useState<Annotation[]>([]), [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const load = () => { void verseAnnotations(key).then(a => { if (active) { setAnnotations(a); setError(""); } }).catch(() => { if (active) setError("Phrase annotations could not be loaded from this device."); }); };
    load(); const off = subscribeStudies(load);
    return () => { active = false; off(); };
  }, [key]);
  return { annotations, error };
}
/** A coloured mark's ink, as Bible Strong draws annotations: a translucent fill, an underline, or a ring. */
function ink(style: Annotation["style"], hex: string): CSSProperties {
  if (style === "highlight") return { background: `color-mix(in srgb, ${hex} 35%, transparent)` };
  if (style === "underline") return { textDecorationColor: hex };
  return { borderColor: hex };
}
/**
 * Offsets address the unmodified KJV text. A changed source never moves a mark onto other words.
 * `selecting` is the word selection being made in the reader, as character offsets; its first and
 * last pieces carry `data-sel-start` / `data-sel-end` for the selection handles.
 */
export function AnnotatedText({ verseKey, text, selecting, colorOf }: { verseKey: string; text: string; selecting?: [number, number]; colorOf?: (key: string) => string | null }) {
  const { annotations } = useAnnotations(verseKey);
  const valid = annotations.filter(a => a.end <= text.length && a.start >= 0 && text.slice(a.start, a.end) === a.quote);
  if (!valid.length && !selecting) return <>{text}</>;
  const boundaries = [...new Set([0, text.length, ...valid.flatMap(a => [a.start, a.end]), ...(selecting ?? [])])].filter(b => b >= 0 && b <= text.length).sort((a, b) => a - b);
  const pieces = boundaries.slice(0, -1).map((start, i) => ({ start, end: boundaries[i + 1] }));
  const inSel = (start: number, end: number) => !!selecting && start >= selecting[0] && end <= selecting[1];
  const chosen = pieces.filter(x => inSel(x.start, x.end)), first = chosen[0]?.start, last = chosen[chosen.length - 1]?.start;
  return <>{pieces.map(({ start, end }) => {
    const over = valid.filter(a => a.start <= start && a.end >= end);
    let style: CSSProperties | undefined;
    for (const a of over) { const hex = a.color && colorOf ? colorOf(a.color) : null; if (hex) style = { ...style, ...ink(a.style, hex) }; }
    const selected = inSel(start, end);
    if (selected && style) delete style.background;
    const className = [...new Set(over.map(a => `phrase-${a.style}`)), ...(selected ? ["phrase-selecting"] : [])].join(" ") || undefined;
    return <span key={start} className={className} style={style} data-sel-start={selected && start === first ? "" : undefined} data-sel-end={selected && start === last ? "" : undefined}>{text.slice(start, end)}</span>;
  })}</>;
}
