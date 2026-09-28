import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";

import { data, shelf, type Book, type Citation, type VerseComment } from "@/api/data";
import { openLink } from "@/tg/sdk";
import { verseNumbers } from "@/api/data";
import { Feather } from "../icons";
import { Sheet } from "./Sheet";
import { Xrefs } from "@/ui/xrefs";
import { preceptsForVerse, slugOfUrl, useTaughtPrecepts } from "@/lib/taught";
import { fmtDate } from "@/api/data";

/**
 * The resource sheet a long press (or the Study tab) opens for one verse: Dictionary,
 * Themes, References and Comments, on a bottom bar as Bible Strong's ResourcesModal (its
 * Lexicon and Compare tabs need Strong's numbers and a second version, which this library
 * does not carry).
 */
export type ResourceTab = "precepts" | "dictionary" | "themes" | "references" | "commentary";
const TABS: { id: ResourceTab; label: string; subtitle: string }[] = [
  { id: "precepts", label: "Precepts", subtitle: "Precepts taught with this verse" }, { id: "dictionary", label: "Dictionary", subtitle: "Dictionary" }, { id: "themes", label: "Themes", subtitle: "By themes" }, { id: "references", label: "References", subtitle: "Cross References" }, { id: "commentary", label: "Comments", subtitle: "Comments" },
];
const STOP = new Set("the and for that with unto them they thou thee thy his him her she you your our this these those from into upon shall will hath have had not but which whom who whose what when where there their were was are said saith came come went also then than all any every because before after more most such very over under out off yet let did doth till until against among".split(" "));
type Entry = { slug: string; term: string; definitions: string[] };

export function ResourcesSheet({ open, onClose, tab, setTab, slug, chapter, verse, text, reference, books }: { open: boolean; onClose: () => void; tab: ResourceTab; setTab: (t: ResourceTab) => void; slug: string; chapter: number; verse: number; text: string; reference: string; books: Book[] }) {
  const navigate = useNavigate();
  const words = [...new Set(text.replace(/[^A-Za-z' ]/g, " ").split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w.toLowerCase())))].slice(0, 40);
  const dict = useQuery({ queryKey: ["dict-from", words.join(",")], enabled: open && tab === "dictionary" && words.length > 0, queryFn: async () => {
    const hits = await Promise.all(words.map((w) => fetch(`/api/dictionary/lookup?word=${encodeURIComponent(w)}`).then((r) => (r.ok ? (r.json() as Promise<Entry>) : null)).catch(() => null)));
    const seen = new Set<string>(); return hits.filter((h): h is Entry => !!h && !seen.has(h.slug) && seen.add(h.slug) !== undefined);
  } });
  const xref = useQuery({ queryKey: ["xref", slug, chapter], enabled: open && tab === "references", queryFn: () => data.xref(slug, chapter).catch(() => ({})) });
  const cites = useQuery({ queryKey: ["cites", slug, chapter], enabled: open && (tab === "commentary" || tab === "themes"), queryFn: () => data.concordance(slug, chapter).then((c) => c.cited_by).catch(() => [] as Citation[]) });
  const taught = useTaughtPrecepts(open && tab === "precepts" ? slug : "", chapter);
  const precepts = preceptsForVerse(taught.data, verse);
  const topicHits = useQuery({ queryKey: ["cites", slug, chapter], enabled: open && tab === "precepts", queryFn: () => data.concordance(slug, chapter).then((c) => c.cited_by).catch(() => [] as Citation[]) });
  const topics = (topicHits.data ?? []).filter((c) => c.kind === "precept" && (!c.verses || verseNumbers(c.verses).includes(verse)));
  const readRef = (url: string, verses: string) => { const m = slugOfUrl(url); onClose(); navigate(m ? `/read/${m[1]}/${m[2]}${verses ? `?v=${verses}` : ""}` : toApp(url)); };
  const forVerse = (rows: Citation[] | undefined) => (rows ?? []).filter((c) => !c.verses || verseNumbers(c.verses).includes(verse));
  const refs = (xref.data as Record<string, [string, number, number][]> | undefined)?.[String(verse)] ?? [];
  const themes = forVerse(cites.data).filter((c) => /^\/(law|precepts|cases|topics)\//.test(c.url));
  const comments = forVerse(cites.data).filter((c) => !/^\/(law|precepts|cases|topics)\//.test(c.url));
  // The classes' own breakdowns of this verse, newest class first.
  const said = useQuery({ queryKey: ["commentary", slug, chapter], enabled: open && tab === "commentary", queryFn: () => data.concordance(slug, chapter).then((c) => c.commentary ?? []).catch(() => [] as VerseComment[]) });
  const breakdowns = (said.data ?? []).filter((c) => verseNumbers(c.verses).includes(verse)).sort((a, b) => b.note.date.localeCompare(a.note.date));
  return (
    <Sheet open={open} onClose={onClose} height="full" title={reference} subTitle={TABS.find((t) => t.id === tab)?.subtitle} footer={
      <div className="bs-resourcetabs" role="tablist">
        {TABS.map((t) => <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} style={{ opacity: tab === t.id ? 1 : 0.3 }} onClick={() => setTab(t.id)}><Feather name={{ precepts: "git-merge", dictionary: "book", themes: "layers", references: "external-link", commentary: "edit-3" }[t.id] as "book"} size={18} color="var(--bs-primary)" /><span>{t.label}</span></button>)}
      </div>
    }>
      <div className="bs-resources">
        <p className="bs-resources__verse"><b>{verse}</b> {text}</p>
        {tab === "precepts" ? (taught.isPending ? <p className="bs-loading">Loading...</p> : !precepts.length && !topics.length ? <p className="bs-loading">No class has lined a precept up with this verse yet.</p> : <>
          {precepts.map((r, i) => (
            <button key={i} type="button" className="bs-resrow bs-precept" data-kind={r.kind} onClick={() => readRef(r.ref.url, r.ref.verses)}>
              <b><span className="bs-precept__kind">{r.kind === "precept" ? "Precept" : "Opened at"}</span> {r.ref.label}</b>
              {r.text ? <span className="bs-precept__text">{r.text}</span> : null}
              <small>{r.note.label}{r.note.date ? ` · ${fmtDate(r.note.date)}` : ""}{r.note.teacher ? ` · ${r.note.teacher}` : ""}</small>
            </button>
          ))}
          {topics.length ? <p className="bs-resources__sub">Precept topics</p> : null}
          {topics.map((c) => <TopicPrecepts key={c.url} cite={c} onRead={readRef} onOpen={() => { onClose(); navigate(toApp(c.url)); }} />)}
        </>) : null}
        {tab === "dictionary" ? (dict.isPending && words.length ? <p className="bs-loading">Loading...</p> : !dict.data?.length ? <p className="bs-loading">No dictionary entry for the words in this verse.</p> : dict.data.map((e) => <button key={e.slug} type="button" className="bs-resrow" onClick={() => { onClose(); navigate(`/dictionary/${e.slug}`); }}><b>{e.term}</b><small>{e.definitions[0]}</small></button>)) : null}
        {tab === "themes" ? (cites.isPending ? <p className="bs-loading">Loading...</p> : !themes.length ? <p className="bs-loading">No law, precept, case or topic cites this verse.</p> : themes.map((c) => <button key={c.url} type="button" className="bs-resrow" onClick={() => { onClose(); navigate(toApp(c.url)); }}><b>{c.label}</b><small>{shelf(c.url, c.kind)}</small></button>)) : null}
        {tab === "references" ? (xref.isPending ? <p className="bs-loading">Loading...</p> : !refs.length ? <p className="bs-loading">No cross references for this verse.</p> : <div className="bs-resources__xrefs"><Xrefs refs={refs} books={books} /></div>) : null}
        {tab === "commentary" ? (cites.isPending || said.isPending ? <p className="bs-loading">Loading...</p> : !comments.length && !breakdowns.length ? <p className="bs-loading">No class or study note teaches from this verse yet.</p> : <>
          {breakdowns.map((c, i) => (
            <div key={`${c.note.url}${c.ts}${i}`} className="bs-comment">
              <button type="button" className="bs-comment__class" onClick={() => { onClose(); navigate(toApp(c.note.url)); }}>
                <b>{c.note.label}</b>
                <small>{[c.note.date ? fmtDate(c.note.date) : "", c.note.teacher, c.passage].filter(Boolean).join(" · ")}</small>
              </button>
              <ul className="bs-comment__points">{c.points.map((pt, j) => <li key={j}>{pt}</li>)}</ul>
              {c.video ? <button type="button" className="bs-comment__watch" onClick={() => openLink(`https://www.youtube.com/watch?v=${c.video}${c.t ? `&t=${c.t}s` : ""}`)}><Feather name="play" size={14} color="var(--bs-primary)" /> Watch from {c.ts || "the start"}</button> : null}
            </div>
          ))}
          {comments.length ? <p className="bs-resources__sub">{breakdowns.length ? "Also taught in" : "Taught in"}</p> : null}
          {comments.map((c) => <button key={c.url} type="button" className="bs-resrow" onClick={() => { onClose(); navigate(toApp(c.url)); }}><b>{c.label}</b><small>{shelf(c.url, c.kind)}{c.verses ? ` · v. ${c.verses}` : ""}</small></button>)}
        </>) : null}
      </div>
    </Sheet>
  );
}

import { toAppPath } from "@shared/links.mjs";
const toApp = (sitePath: string) => toAppPath(sitePath) ?? sitePath;

/** A precept topic from the reference work that lists this verse, with its other scriptures a tap away. */
function TopicPrecepts({ cite, onRead, onOpen }: { cite: Citation; onRead: (url: string, verses: string) => void; onOpen: () => void }) {
  const [openList, setOpenList] = useState(false);
  const slug = cite.url.replace(/^\/precepts\//, "");
  const topic = useQuery({ queryKey: ["precept", slug], enabled: openList, staleTime: Infinity, queryFn: () => data.precept(slug) });
  return (
    <div className="bs-topic">
      <button type="button" className="bs-resrow" onClick={() => setOpenList(!openList)}><b>{cite.label}</b><small>{openList ? "Hide the scriptures" : "All the scriptures of this precept"}</small></button>
      {openList ? (topic.isPending ? <p className="bs-loading">Loading...</p> : <div className="bs-topic__refs">
        {(topic.data?.refs ?? []).map((r) => <button key={r.label} type="button" className="bs-topic__ref" onClick={() => (r.url ? onRead(r.url, r.verses ?? "") : onOpen())}><b>{r.label}</b>{r.text?.[0] ? <span>{r.text[0].text}</span> : null}</button>)}
        <button type="button" className="bs-link" onClick={onOpen}>Open the precept</button>
      </div>) : null}
    </div>
  );
}
