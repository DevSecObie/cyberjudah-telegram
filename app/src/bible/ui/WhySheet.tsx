import { useQueries } from "@tanstack/react-query";

import { data, fmtDate, verseNumbers, type TaughtPrecept, type VerseNote } from "@/api/data";
import { preceptsForVerse, slugOfUrl, teacherRank, useTaughtPrecepts } from "@/lib/taught";
import { Feather } from "../icons";
import { Sheet } from "./Sheet";

/**
 * The note that leads a verse's precepts: a quick breakdown of why each precept is there,
 * one line each, from the class that lined it up, with the precept's words to hand. A tap on
 * a precept reads it; the class line opens the class at that moment.
 */
export function WhySheet({ open, onClose, slug, chapter, verse, reference, onRead, onOpenClass }: {
  open: boolean; onClose: () => void; slug: string; chapter: number; verse: number; reference: string;
  onRead: (url: string, verses: string) => void; onOpenClass: (url: string, ts: string) => void;
}) {
  const taught = useTaughtPrecepts(open ? slug : "", chapter);
  const rows = preceptsForVerse(taught.data, verse).sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "precept" ? -1 : 1) || teacherRank(a.note.teacher) - teacherRank(b.note.teacher));
  // One line per precept: the first class's reason, the others counted.
  const seen = new Map<string, { r: TaughtPrecept; more: number }>();
  for (const r of rows) { const k = `${r.kind}|${r.ref.url}|${r.ref.verses}`; const e = seen.get(k); if (e) e.more++; else seen.set(k, { r, more: 0 }); }
  const items = [...seen.values()];
  // Until a precept has its own line, the class's point for the passage says it, once, above
  // the precepts it covers, not repeated under each.
  const leads = new Map<string, TaughtPrecept>();
  for (const { r } of items) if (!r.why && r.point && !leads.has(r.point)) leads.set(r.point, r);
  const chapters = [...new Set(items.map(({ r }) => slugOfUrl(r.ref.url)).filter(Boolean).map((m) => `${m![1]}/${m![2]}`))];
  const texts = useQueries({ queries: chapters.map((c) => { const [s, ch] = c.split("/"); return { queryKey: ["chapter", s, Number(ch)], queryFn: () => data.chapter(s, Number(ch)), staleTime: Infinity, enabled: open }; }) });
  const words = (r: TaughtPrecept) => {
    const m = slugOfUrl(r.ref.url); const c = m ? texts[chapters.indexOf(`${m[1]}/${m[2]}`)]?.data : undefined;
    const want = new Set(verseNumbers(r.ref.verses));
    return c ? c.verses.filter((v) => want.has(v.verse)).map((v) => v.text).join(" ") : "";
  };
  return (
    <Sheet open={open} onClose={onClose} height="full" title={reference} subTitle={items.length > 1 ? "Precepts" : "Precept"} className="why-sheet">
      <div className="why">
        {[...leads.values()].map((r) => (
          <div key={`lead|${r.point}`} className="why__lead">
            <p className="why__reason">{r.point}</p>
            <button type="button" className="why__src" onClick={() => onOpenClass(r.note.url, r.ts)}>{r.note.label}{r.note.date ? ` · ${fmtDate(r.note.date)}` : ""}{r.ts ? ` · ${r.ts}` : ""}</button>
          </div>
        ))}
        {taught.isPending ? <p className="bs-loading">Loading...</p> : !items.length ? <p className="bs-loading">No precept is lined up with this verse.</p> : items.map(({ r, more }) => (
          <div key={`${r.kind}|${r.ref.url}|${r.ref.verses}`} className="why__item">
            <button type="button" className="why__ref" onClick={() => onRead(r.ref.url, r.ref.verses)}>
              <span className="why__kind">{r.kind === "precept" ? "Precept" : "Precept for"}</span>
              <b>{r.ref.label}</b>
              <Feather name="chevron-right" size={15} color="var(--bs-tertiary)" />
            </button>
            {words(r) ? <p className="why__words">{words(r)}</p> : null}
            {r.why ? <p className="why__reason">{r.why}</p> : null}
            {r.why || more ? <button type="button" className="why__src" onClick={() => onOpenClass(r.note.url, r.ts)}>{r.note.label}{r.note.date ? ` · ${fmtDate(r.note.date)}` : ""}{r.ts ? ` · ${r.ts}` : ""}{more ? ` · and ${more} more class${more > 1 ? "es" : ""}` : ""}</button> : null}
          </div>
        ))}
      </div>
    </Sheet>
  );
}
export type { VerseNote };
