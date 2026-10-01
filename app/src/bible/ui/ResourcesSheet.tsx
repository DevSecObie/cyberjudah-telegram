import { useQuery } from "@tanstack/react-query";
import { avatarKind, EntityAvatar } from "@/ui/avatar";
import { useState } from "react";
import { useNavigate } from "react-router";

import { data, shelf, type Book, type Citation, type VerseComment } from "@/api/data";
import { openLink } from "@/tg/sdk";
import { verseNumbers } from "@/api/data";
import { Feather } from "../icons";
import { Sheet } from "./Sheet";
import { WordSheet } from "./WordSheet";
import { Xrefs } from "@/ui/xrefs";
import { preceptsForVerse, slugOfUrl, teacherRank, usePeopleNamed, useReadings, useTaughtPrecepts } from "@/lib/taught";
import { fmtDate } from "@/api/data";

/**
 * The resource sheet a long press (or the Study tab) opens for one verse: Dictionary,
 * Themes, References and Comments, on a bottom bar as Bible Strong's ResourcesModal (its
 * Lexicon and Compare tabs need Strong's numbers and a second version, which this library
 * does not carry).
 */
export type ResourceTab = "words" | "precepts" | "people" | "dictionary" | "themes" | "references" | "commentary";
const TABS: { id: ResourceTab; label: string; subtitle: string }[] = [
  { id: "words", label: "Words", subtitle: "Strong's: the Hebrew and Greek behind each word" }, { id: "precepts", label: "Precepts", subtitle: "Precepts taught with this verse" }, { id: "people", label: "People", subtitle: "People named in this verse" }, { id: "dictionary", label: "Dictionary", subtitle: "Dictionary" }, { id: "themes", label: "Themes", subtitle: "By themes" }, { id: "references", label: "References", subtitle: "Cross References" }, { id: "commentary", label: "Comments", subtitle: "Comments" },
];
const STOP = new Set("the and for that with unto them they thou thee thy his him her she you your our this these those from into upon shall will hath have had not but which whom who whose what when where there their were was are said saith came come went also then than all any every because before after more most such very over under out off yet let did doth till until against among".split(" "));
type Entry = { slug: string; term: string; definitions: string[] };

export function ResourcesSheet({ open, onClose, tab, setTab, slug, chapter, verse, text, reference, books }: { open: boolean; onClose: () => void; tab: ResourceTab; setTab: (t: ResourceTab) => void; slug: string; chapter: number; verse: number; text: string; reference: string; books: Book[] }) {
  const navigate = useNavigate();
  const [word, setWord] = useState<string | null>(null);
  // Where the reader came from, so a note or teaching can offer the way back to this verse.
  const from = `from=${encodeURIComponent(`/read/${slug}/${chapter}?v=${verse}`)}`;
  const withFrom = (path: string) => `${path}${path.includes("?") ? "&" : "?"}${from}`;
  const spans = useQuery({ queryKey: ["chapter", slug, chapter], enabled: open && tab === "words", staleTime: Infinity, queryFn: () => data.chapter(slug, chapter) });
  const verseWords = spans.data?.verses.find((v) => v.verse === verse)?.words;
  // The Apocrypha have no Strong's numbers; the Greek of the verse from Swete's Septuagint stands in.
  const lxx = useQuery({ queryKey: ["lxx", slug, chapter], enabled: open && tab === "words" && !!spans.data && !verseWords, staleTime: Infinity, retry: false, queryFn: () => data.lxx(slug, chapter).catch(() => null) });
  const greek = lxx.data?.verses?.[String(verse)];
  const words = [...new Set(text.replace(/[^A-Za-z' ]/g, " ").split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w.toLowerCase())))].slice(0, 40);
  const dict = useQuery({ queryKey: ["dict-from", words.join(",")], enabled: open && tab === "dictionary" && words.length > 0, queryFn: async () => {
    const hits = await Promise.all(words.map((w) => fetch(`/api/dictionary/lookup?word=${encodeURIComponent(w)}`).then((r) => (r.ok ? (r.json() as Promise<Entry>) : null)).catch(() => null)));
    const seen = new Set<string>(); return hits.filter((h): h is Entry => !!h && !seen.has(h.slug) && seen.add(h.slug) !== undefined);
  } });
  const xref = useQuery({ queryKey: ["xref", slug, chapter], enabled: open && tab === "references", queryFn: () => data.xref(slug, chapter).catch(() => ({})) });
  const cites = useQuery({ queryKey: ["cites", slug, chapter], enabled: open && (tab === "commentary" || tab === "themes"), queryFn: () => data.concordance(slug, chapter).then((c) => c.cited_by).catch(() => [] as Citation[]) });
  const taught = useTaughtPrecepts(open && tab === "precepts" ? slug : "", chapter);
  const precepts = preceptsForVerse(taught.data, verse).sort((a, b) => teacherRank(a.note.teacher) - teacherRank(b.note.teacher));
  const topicHits = useQuery({ queryKey: ["cites", slug, chapter], enabled: open && tab === "precepts", queryFn: () => data.concordance(slug, chapter).then((c) => c.cited_by).catch(() => [] as Citation[]) });
  const topics = (topicHits.data ?? []).filter((c) => c.kind === "precept" && (!c.verses || verseNumbers(c.verses).includes(verse)));
  const named = usePeopleNamed(open && tab === "people" ? slug : "", chapter);
  const everyone = useQuery({ queryKey: ["people-index"], enabled: open && tab === "people", staleTime: Infinity, queryFn: () => data.people() });
  const here = (named.data?.[String(verse)] ?? []).map((id) => everyone.data?.find((p) => p.id === id)).filter((p): p is NonNullable<typeof p> => !!p);
  const readRef = (url: string, verses: string) => { const m = slugOfUrl(url); onClose(); navigate(m ? `/read/${m[1]}/${m[2]}${verses ? `?v=${verses}` : ""}` : toApp(url)); };
  const forVerse = (rows: Citation[] | undefined) => (rows ?? []).filter((c) => !c.verses || verseNumbers(c.verses).includes(verse));
  const refs = (xref.data as Record<string, [string, number, number][]> | undefined)?.[String(verse)] ?? [];
  const themes = forVerse(cites.data).filter((c) => /^\/(law|precepts|cases|topics)\//.test(c.url));
  const comments = forVerse(cites.data).filter((c) => !/^\/(law|precepts|cases|topics)\//.test(c.url));
  // "Also taught in": one row per note that cites this verse itself (not only its chapter),
  // leaving out the notes whose breakdown is already shown above.
  // The classes' own breakdowns of this verse, newest class first.
  const said = useQuery({ queryKey: ["commentary", slug, chapter], enabled: open && tab === "commentary", queryFn: () => data.concordance(slug, chapter).then((c) => c.commentary ?? []).catch(() => [] as VerseComment[]) });
  const breakdowns = (said.data ?? []).filter((c) => verseNumbers(c.verses).includes(verse)).sort((a, b) => teacherRank(a.note.teacher) - teacherRank(b.note.teacher) || b.note.date.localeCompare(a.note.date));
  // Every class that read this verse aloud, from the transcripts: Bishops first, then newest first.
  const readings = useReadings(open && tab === "commentary" ? slug : "", chapter);
  const readHere = readings.data?.[String(verse)] ?? [];
  const [allRead, setAllRead] = useState(false);
  const shown = new Set(breakdowns.map((c) => c.note.url));
  const also = [...new Map(comments.filter((c) => c.verses && !shown.has(c.url)).map((c) => [c.url, c] as const)).values()];
  return (
    <Sheet open={open} onClose={onClose} height="full" title={reference} subTitle={TABS.find((t) => t.id === tab)?.subtitle} footer={
      <div className="bs-resourcetabs" role="tablist">
        {TABS.map((t) => <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} style={{ opacity: tab === t.id ? 1 : 0.3 }} onClick={() => setTab(t.id)}><Feather name={{ words: "hash", precepts: "git-merge", people: "users", dictionary: "book", themes: "layers", references: "external-link", commentary: "edit-3" }[t.id] as "book"} size={18} color="var(--bs-primary)" /><span>{t.label}</span></button>)}
      </div>
    }>
      <div className="bs-resources">
        <p className="bs-resources__verse"><b>{verse}</b> {text}</p>
        {tab === "words" ? (spans.isPending ? <p className="bs-loading">Loading...</p> : !verseWords ? (lxx.isPending ? <p className="bs-loading">Loading...</p> : greek ? (
          <div className="bs-greek">
            <p className="bs-resources__sub">The Greek of this verse</p>
            <p className="bs-greek__text" lang="grc">{greek}</p>
            <p className="bs-greek__src">Swete's Septuagint (1909), verse {verse} as Swete numbers it; the King James Apocrypha were translated from this Greek. Strong's numbers cover the 66 books only.</p>
          </div>
        ) : <p className="bs-loading">Strong's numbers cover the 66 books; this verse has none.</p>) : <>
          <p className="bs-words__hint">Tap a word for the Hebrew or Greek behind it, what it means, and every verse that uses it.</p>
          <div className="bs-words">{verseWords.map(([t, nums], i) => nums.length
            ? <button key={i} type="button" className="bs-words__w" onClick={() => setWord(nums[0])}>{t}<small>{nums.join(" ")}</small></button>
            : <span key={i} className="bs-words__plain">{t}</span>)}</div>
          {word ? <WordSheet number={word} open onClose={() => { setWord(null); onClose(); }} onBack={() => setWord(null)} books={books} here={{ slug, chapter, verse }} /> : null}
        </>) : null}
        {tab === "precepts" ? (taught.isPending ? <p className="bs-loading">Loading...</p> : !precepts.length && !topics.length ? <p className="bs-loading">No class has lined a precept up with this verse yet.</p> : <>
          {precepts.map((r, i) => (
            <button key={i} type="button" className="bs-resrow bs-precept" data-kind={r.kind} onClick={() => readRef(r.ref.url, r.ref.verses)}>
              <b><span className="bs-precept__kind">{r.kind === "precept" ? "Precept" : "Opened at"}</span> {r.ref.label}</b>
              {r.text ? <span className="bs-precept__text">{r.text}</span> : null}
              <small>{r.note.label}{r.note.date ? ` · ${fmtDate(r.note.date)}` : ""}{r.note.teacher ? ` · ${r.note.teacher}` : ""}</small>
            </button>
          ))}
          {topics.length ? <p className="bs-resources__sub">Precept topics</p> : null}
          {topics.map((c) => <TopicPrecepts key={c.url} cite={c} onRead={readRef} onOpen={() => { onClose(); navigate(withFrom(toApp(c.url))); }} />)}
        </>) : null}
        {tab === "people" ? (named.isPending || everyone.isPending ? <p className="bs-loading">Loading...</p> : !here.length ? <p className="bs-loading">No one is named in this verse.</p> : here.map((p) => <button key={p.id} type="button" className="bs-resrow bs-resrow--person" onClick={() => { onClose(); navigate(`/person/${p.id}`); }}><EntityAvatar name={p.name} kind={avatarKind(p.type)} size={40} ink={avatarKind(p.type) === "female" ? "var(--bs-quart)" : "var(--bs-primary)"} base="var(--bs-reverse)" /><span><b>{p.name}</b><small>{p.description}{p.verses ? ` · named in ${p.verses} ${p.verses === 1 ? "verse" : "verses"}` : ""}</small></span></button>)) : null}
        {tab === "dictionary" ? (dict.isPending && words.length ? <p className="bs-loading">Loading...</p> : !dict.data?.length ? <p className="bs-loading">No dictionary entry for the words in this verse.</p> : dict.data.map((e) => <button key={e.slug} type="button" className="bs-resrow" onClick={() => { onClose(); navigate(`/dictionary/${e.slug}`); }}><b>{e.term}</b><small>{e.definitions[0]}</small></button>)) : null}
        {tab === "themes" ? (cites.isPending ? <p className="bs-loading">Loading...</p> : !themes.length ? <p className="bs-loading">No law, precept, case or topic cites this verse.</p> : themes.map((c) => <button key={c.url} type="button" className="bs-resrow" onClick={() => { onClose(); navigate(withFrom(toApp(c.url))); }}><b>{c.label}</b><small>{shelf(c.url, c.kind)}</small></button>)) : null}
        {tab === "references" ? (xref.isPending ? <p className="bs-loading">Loading...</p> : !refs.length ? <p className="bs-loading">No cross references for this verse.</p> : <div className="bs-resources__xrefs"><Xrefs refs={refs} books={books} /></div>) : null}
        {tab === "commentary" ? (cites.isPending || said.isPending ? <p className="bs-loading">Loading...</p> : !also.length && !breakdowns.length && !readHere.length ? <p className="bs-loading">No class or study note teaches from this verse yet.</p> : <>
          {breakdowns.map((c, i) => (
            <div key={`${c.note.url}${c.ts}${i}`} className="bs-comment">
              <button type="button" className="bs-comment__class" onClick={() => { if (/^https?:/.test(c.note.url)) { openLink(`${c.note.url}${c.t ? `&t=${c.t}s` : ""}`); return; } onClose(); navigate(passageLink(c).replace("#", `?${from}#`).replace(/\?t=(\d+)\?/, "?t=$1&")); }}>
                <b>{c.note.label}</b>
                <small>{[c.note.date ? fmtDate(c.note.date) : "", c.note.teacher, c.passage].filter(Boolean).join(" · ")}</small>
              </button>
              <ul className="bs-comment__points">{c.points.map((pt, j) => <li key={j}>{pt}</li>)}</ul>
              {c.video ? <button type="button" className="bs-comment__watch" onClick={() => openLink(`https://www.youtube.com/watch?v=${c.video}${c.t ? `&t=${c.t}s` : ""}`)}><Feather name="play" size={14} color="var(--bs-primary)" /> Watch from {c.ts || "the start"}</button> : null}
            </div>
          ))}
          {readHere.length ? <>
            <p className="bs-resources__sub">Read in {readHere.length === 1 ? "one class" : `${readHere.length} classes`}</p>
            <div className="bs-readin">
              {(allRead ? readHere : readHere.slice(0, 6)).map((r) => (
                <button key={`${r.video}-${r.t}`} type="button" className="bs-readin__row" onClick={() => { onClose(); navigate(withFrom(r.url ? `${toApp(r.url)}?t=${r.t}` : `/watch/${r.video}?t=${r.t}`)); }}>
                  <span className="bs-readin__ts"><Feather name="play" size={12} color="var(--bs-primary)" />{r.ts}</span>
                  <span className="bs-readin__what"><b>{r.title}</b><small>{[r.date ? fmtDate(r.date) : "", r.teacher].filter(Boolean).join(" · ")}</small></span>
                </button>
              ))}
              {!allRead && readHere.length > 6 ? <button type="button" className="bs-readin__more" onClick={() => setAllRead(true)}>All {readHere.length} classes</button> : null}
            </div>
          </> : null}
          {also.length ? <p className="bs-resources__sub">{breakdowns.length ? "Also taught in" : "Taught in"}</p> : null}
          {also.map((c) => <button key={c.url} type="button" className="bs-resrow" onClick={() => { onClose(); navigate(`${toApp(c.url)}#p-${`${reference.replace(/:.*$/, "")}:${c.verses}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`); }}><b>{c.label.replace(/^[^·]+·\s*/, "")}</b><small>{shelf(c.url, c.kind)} · {reference.replace(/:.*$/, "")}:{c.verses}</small></button>)}
        </>) : null}
      </div>
    </Sheet>
  );
}

import { toAppPath } from "@shared/links.mjs";
const toApp = (sitePath: string) => toAppPath(sitePath) ?? sitePath;
/** A note opened right where it breaks down this passage, and a class's recording at that second. */
const passageLink = (c: VerseComment) => `${toApp(c.note.url)}${c.t ? `?t=${c.t}` : ""}#p-${c.passage.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;

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
