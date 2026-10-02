import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { data, verseNumbers, type Book } from "@/api/data";
import { preceptsForVerse, slugOfUrl, teacherRank, useTaughtPrecepts } from "@/lib/taught";
import { haptic } from "@/tg/sdk";
import { Sheet } from "./Sheet";

/**
 * A verse beside what proves it: the King James text on top, and under it every cross
 * reference and every precept the classes lined up with it, each with its own verse text
 * written out, so a brother teaching from his phone on the street reads the verse and its
 * proofs together without leaving the sheet. Copy sends the verse and its proofs as one text.
 */
export function CompareSheet({ open, onClose, slug, chapter, verse, text, reference, books, onRead }: { open: boolean; onClose: () => void; slug: string; chapter: number; verse: number; text: string; reference: string; books: Book[]; onRead: (slug: string, chapter: number, verse: number) => void }) {
  const [lane, setLane] = useState<"precepts" | "references">("precepts");
  const [copied, setCopied] = useState(false);
  const name = (s: string) => books.find((b) => b.slug === s)?.book ?? s;
  const xref = useQuery({ queryKey: ["xref", slug, chapter], enabled: open, queryFn: () => data.xref(slug, chapter).catch(() => ({})) });
  const refs = ((xref.data as Record<string, [string, number, number][]> | undefined)?.[String(verse)] ?? []).slice(0, 24);
  const taught = useTaughtPrecepts(open ? slug : "", chapter);
  const precepts = preceptsForVerse(taught.data, verse).sort((a, b) => teacherRank(a.note.teacher) - teacherRank(b.note.teacher));
  const items: { key: string; slug: string; chapter: number; verses: number[]; label: string; why?: string; teacher?: string; kind: "precept" | "opened" | "xref" }[] = lane === "references"
    ? refs.map(([s, c, v]) => ({ key: `x:${s}/${c}/${v}`, slug: s, chapter: c, verses: [v], label: `${name(s)} ${c}:${v}`, kind: "xref" as const }))
    : precepts.map((p) => { const m = slugOfUrl(p.ref.url); const vs = p.ref.verses ? verseNumbers(p.ref.verses).slice(0, 4) : [1]; return { key: `p:${p.ref.url}|${p.note.url}`, slug: m?.[1] ?? slug, chapter: m ? +m[2] : chapter, verses: vs, label: p.ref.label, why: p.why || p.text || undefined, teacher: p.note.teacher, kind: p.kind }; });
  const copyAll = async () => {
    const lines = [`${reference} ${text}`, ""];
    for (const it of items) { const t = textCache.get(`${it.slug}/${it.chapter}`); if (t) lines.push(`${it.label} ${it.verses.map((v) => t[v - 1] ?? "").join(" ")}`); if (it.why) lines.push(`  ${it.why}`); lines.push(""); }
    try { await navigator.clipboard.writeText(lines.join("\n").trim()); haptic("success"); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard may be unavailable */ }
  };
  return (
    <Sheet open={open} onClose={onClose} height="full" title="Precepts side by side" subTitle={reference} label="Precepts side by side" right={<button type="button" className="bs-compare__copy" onClick={() => void copyAll()}>{copied ? "Copied" : "Copy all"}</button>}>
      <div className="bs-compare">
        <blockquote className="bs-compare__verse"><b>{reference}</b><p>{text}</p></blockquote>
        <div className="bs-compare__lanes" role="tablist">
          <button type="button" role="tab" aria-selected={lane === "precepts"} onClick={() => { haptic("select"); setLane("precepts"); }}>Precepts{precepts.length ? ` · ${precepts.length}` : ""}</button>
          <button type="button" role="tab" aria-selected={lane === "references"} onClick={() => { haptic("select"); setLane("references"); }}>Cross references{refs.length ? ` · ${refs.length}` : ""}</button>
        </div>
        {(lane === "precepts" ? taught.isPending : xref.isPending) ? <p className="bs-loading">Loading...</p> : !items.length ? <p className="bs-loading">{lane === "precepts" ? "No class has lined a precept up with this verse yet." : "No cross references for this verse."}</p> : (
          <ol className="bs-compare__list">
            {items.map(({ key, ...it }) => <CompareItem key={key} {...it} onRead={() => { onClose(); onRead(it.slug, it.chapter, it.verses[0]); }} />)}
          </ol>
        )}
      </div>
    </Sheet>
  );
}

/** Chapter texts seen while the sheet is open, so Copy all can include them without waiting. */
const textCache = new Map<string, string[]>();

function CompareItem({ slug, chapter, verses, label, why, teacher, kind, onRead }: { slug: string; chapter: number; verses: number[]; label: string; why?: string; teacher?: string; kind: "precept" | "opened" | "xref"; onRead: () => void }) {
  const q = useQuery({ queryKey: ["chapter", slug, chapter], queryFn: () => data.chapter(slug, chapter), staleTime: Infinity });
  if (q.data) textCache.set(`${slug}/${chapter}`, q.data.verses.map((v) => v.text));
  return (
    <li className="bs-compare__item" data-kind={kind}>
      <button type="button" className="bs-compare__ref" onClick={onRead}><b>{label}</b>{kind === "opened" ? <small>opened with this verse as the precept</small> : teacher ? <small>{teacher}</small> : null}</button>
      <p className="bs-compare__text">{q.isPending ? <span className="skel" style={{ width: "80%" }} /> : verses.map((v) => { const row = q.data?.verses.find((x) => x.verse === v); return row ? <span key={v}><sup>{v}</sup>{row.text} </span> : null; })}</p>
      {why ? <p className="bs-compare__why">{why}</p> : null}
    </li>
  );
}
