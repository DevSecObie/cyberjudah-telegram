import { useEffect, useState } from "react";
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
/** Offsets address the unmodified KJV text. A changed source never moves a mark onto other words. */
export function AnnotatedText({ verseKey, text }: { verseKey: string; text: string }) {
  const { annotations } = useAnnotations(verseKey);
  const valid = annotations.filter(a => a.end <= text.length && a.start >= 0 && text.slice(a.start, a.end) === a.quote);
  if (!valid.length) return <>{text}</>;
  const boundaries = [...new Set([0, text.length, ...valid.flatMap(a => [a.start, a.end])])].sort((a, b) => a - b);
  return <>{boundaries.slice(0, -1).map((start, i) => {
    const end = boundaries[i + 1], styles = [...new Set(valid.filter(a => a.start <= start && a.end >= end).map(a => a.style))];
    return <span key={start} className={styles.map(s => `phrase-${s}`).join(" ") || undefined}>{text.slice(start, end)}</span>;
  })}</>;
}
