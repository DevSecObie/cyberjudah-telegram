import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";

import { data, shelf, type Book, type Citation } from "@/api/data";
import { verseNumbers } from "@/api/data";
import { Feather } from "../icons";
import { Sheet } from "./Sheet";
import { Xrefs } from "@/ui/xrefs";

/**
 * The resource sheet a long press (or the Study tab) opens for one verse: Dictionary,
 * Themes, References and Comments, on a bottom bar as Bible Strong's ResourcesModal (its
 * Lexicon and Compare tabs need Strong's numbers and a second version, which this library
 * does not carry).
 */
export type ResourceTab = "dictionary" | "themes" | "references" | "commentary";
const TABS: { id: ResourceTab; label: string; subtitle: string }[] = [
  { id: "dictionary", label: "Dictionary", subtitle: "Dictionary" }, { id: "themes", label: "Themes", subtitle: "By themes" }, { id: "references", label: "References", subtitle: "Cross References" }, { id: "commentary", label: "Comments", subtitle: "Comments" },
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
  const forVerse = (rows: Citation[] | undefined) => (rows ?? []).filter((c) => !c.verses || verseNumbers(c.verses).includes(verse));
  const refs = (xref.data as Record<string, [string, number, number][]> | undefined)?.[String(verse)] ?? [];
  const themes = forVerse(cites.data).filter((c) => /^\/(law|precepts|cases|topics)\//.test(c.url));
  const comments = forVerse(cites.data).filter((c) => !/^\/(law|precepts|cases|topics)\//.test(c.url));
  return (
    <Sheet open={open} onClose={onClose} height="full" title={reference} subTitle={TABS.find((t) => t.id === tab)?.subtitle} footer={
      <div className="bs-resourcetabs" role="tablist">
        {TABS.map((t) => <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} style={{ opacity: tab === t.id ? 1 : 0.3 }} onClick={() => setTab(t.id)}><Feather name={{ dictionary: "book", themes: "layers", references: "external-link", commentary: "edit-3" }[t.id] as "book"} size={18} color="var(--bs-primary)" /><span>{t.label}</span></button>)}
      </div>
    }>
      <div className="bs-resources">
        <p className="bs-resources__verse"><b>{verse}</b> {text}</p>
        {tab === "dictionary" ? (dict.isPending && words.length ? <p className="bs-loading">Loading...</p> : !dict.data?.length ? <p className="bs-loading">No dictionary entry for the words in this verse.</p> : dict.data.map((e) => <button key={e.slug} type="button" className="bs-resrow" onClick={() => { onClose(); navigate(`/dictionary/${e.slug}`); }}><b>{e.term}</b><small>{e.definitions[0]}</small></button>)) : null}
        {tab === "themes" ? (cites.isPending ? <p className="bs-loading">Loading...</p> : !themes.length ? <p className="bs-loading">No law, precept, case or topic cites this verse.</p> : themes.map((c) => <button key={c.url} type="button" className="bs-resrow" onClick={() => { onClose(); navigate(toApp(c.url)); }}><b>{c.label}</b><small>{shelf(c.url, c.kind)}</small></button>)) : null}
        {tab === "references" ? (xref.isPending ? <p className="bs-loading">Loading...</p> : !refs.length ? <p className="bs-loading">No cross references for this verse.</p> : <div className="bs-resources__xrefs"><Xrefs refs={refs} books={books} /></div>) : null}
        {tab === "commentary" ? (cites.isPending ? <p className="bs-loading">Loading...</p> : !comments.length ? <p className="bs-loading">No class or study note teaches from this verse yet.</p> : comments.map((c) => <button key={c.url} type="button" className="bs-resrow" onClick={() => { onClose(); navigate(toApp(c.url)); }}><b>{c.label}</b><small>{shelf(c.url, c.kind)}{c.verses ? ` · v. ${c.verses}` : ""}</small></button>)) : null}
      </div>
    </Sheet>
  );
}

import { toAppPath } from "@shared/links.mjs";
const toApp = (sitePath: string) => toAppPath(sitePath) ?? sitePath;
