import { useEffect, useState } from "react";
import { Sheet } from "@/bible/ui/Sheet";
import { Button } from "@/ui/Button";
import { Icon } from "@/ui/icons";
import { StudyNotice } from "./controls";
import { addAnnotation, removeAnnotation, subscribeStudies, verseAnnotations, type Annotation } from "./storage";
import "./studies.css";

function useAnnotations(key: string) {
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
export function PhraseAnnotations({ verseKey, text, reference, onClose }: { verseKey: string; text: string; reference: string; onClose: () => void }) {
  const { annotations, error: loadError } = useAnnotations(verseKey);
  const [first, setFirst] = useState<number | null>(null), [last, setLast] = useState<number | null>(null), [style, setStyle] = useState<Annotation["style"]>("highlight"), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const words = [...text.matchAll(/\S+/gu)].map(m => ({ text: m[0], start: m.index!, end: m.index! + m[0].length }));
  const start = first === null ? null : Math.min(first, last ?? first), end = first === null ? null : Math.max(first, last ?? first);
  const quote = start === null || end === null ? "" : text.slice(words[start].start, words[end].end);
  const save = async () => {
    if (start === null || end === null) return;
    setBusy(true); setError("");
    try { await addAnnotation({ id: crypto.randomUUID(), verseKey, start: words[start].start, end: words[end].end, quote, style, created: new Date().toISOString() }, text); setFirst(null); setLast(null); }
    catch (e) { setError(e instanceof Error ? e.message : "This annotation could not be saved."); } finally { setBusy(false); }
  };
  return <Sheet open onClose={onClose} title="Mark a phrase" subTitle={reference} height="full"><div className="personal-study">
    <p className="study-muted">Choose the first word, then the last word. Choose one word to mark it on its own.</p>
    <div className="phrase-words" aria-label="Verse words">{words.map((w, i) => <button key={w.start} type="button" aria-label={`Word ${i + 1}: ${w.text}`} aria-pressed={start !== null && end !== null && i >= start && i <= end} onClick={() => { if (first === null || last !== null) { setFirst(i); setLast(null); } else setLast(i); }}>{w.text}</button>)}</div>
    <StudyNotice>{quote ? `Selected: ${quote}` : "Choose a word or phrase."}</StudyNotice>
    <div className="phrase-controls"><label>Mark style<select value={style} onChange={e => setStyle(e.target.value as Annotation["style"])}><option value="highlight">Highlight</option><option value="underline">Underline</option><option value="circle">Circle</option></select></label>
    <Button disabled={!quote || busy} onClick={() => void save()}><Icon name="check" size={18} />Save phrase mark</Button></div>
    {(error || loadError) && <StudyNotice error>{error || loadError}</StudyNotice>}
    {annotations.length > 0 && <h2>Saved marks</h2>}
    {annotations.map(a => <div className="study-block" key={a.id}><p>{a.quote} · {a.style}</p>{text.slice(a.start, a.end) !== a.quote && <p>The source text changed; this mark is kept here but is no longer applied to the verse.</p>}<Button appearance="plain" onClick={() => { void removeAnnotation(a.id).catch(() => setError("Could not remove this mark. Try again.")); }}>Remove mark</Button></div>)}
  </div></Sheet>;
}
