import { WordAlignment } from "./WordAlignment";
import { useQuery } from "@tanstack/react-query";
import { avatarKind, EntityAvatar } from "@/ui/avatar";
import { useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";

import { data, shelf, type Book, type Citation, type VerseComment } from "@/api/data";
import { openLink } from "@/tg/sdk";
import { verseNumbers } from "@/api/data";
import { Feather } from "../icons";
import { ResourceIcon, type ResourceKind } from "./ResourceIcon";
import { Sheet } from "./Sheet";
import { VerseLexicon } from "./VerseLexicon";
import { BibleVerseDetailFooter } from "./BibleVerseDetailFooter";
import { WordSheet } from "./WordSheet";
import { Xrefs } from "@/ui/xrefs";
import { preceptsForVerse, slugOfUrl, teacherRank, usePeopleNamed, useReadings, useTaughtPrecepts } from "@/lib/taught";
import { fmtDate } from "@/api/data";

/**
 * The resource sheet a long press (or the Study tab) opens for one verse, as Bible Strong's
 * ResourcesModal: the verse in the header, the resource's name under it, and the resources on
 * its footer bar (ResourcesModalFooter): Lexicon, Dictionary, Themes, References and Comments,
 * then the classes' Precepts and People. Its Compare needs a second version, which this
 * library does not carry.
 */
export type ResourceTab = "words" | "precepts" | "people" | "dictionary" | "themes" | "references" | "commentary";
const TABS: { id: ResourceTab; label: string; subtitle: string; icon: ResourceKind | "precepts" | "users"; color: string }[] = [
  { id: "words", label: "Lexicon", subtitle: "Lexicon", icon: "strong", color: "var(--bs-primary)" },
  { id: "dictionary", label: "Dictionary", subtitle: "Dictionary", icon: "dictionary", color: "var(--bs-secondary)" },
  { id: "themes", label: "Themes", subtitle: "By themes", icon: "nave", color: "var(--bs-quint)" },
  { id: "references", label: "References", subtitle: "Cross References", icon: "references", color: "var(--bs-quart)" },
  { id: "commentary", label: "Comments", subtitle: "Comments", icon: "commentary", color: "#26A69A" },
  { id: "precepts", label: "Precepts", subtitle: "Precepts", icon: "precepts", color: "var(--bs-tertiary)" },
  { id: "people", label: "People", subtitle: "People", icon: "users", color: "var(--bs-tertiary)" },
];
const STOP = new Set("the and for that with unto them they thou thee thy his him her she you your our this these those from into upon shall will hath have had not but which whom who whose what when where there their were was are said saith came come went also then than all any every because before after more most such very over under out off yet let did doth till until against among".split(" "));
type Entry = { slug: string; term: string; definitions: string[] };

export function ResourcesSheet({ open, onClose, tab, setTab, slug, chapter, verse, verses, onVerse, text, reference, books }: { open: boolean; onClose: () => void; tab: ResourceTab; setTab: (t: ResourceTab) => void; slug: string; chapter: number; verse: number; verses: number; onVerse: (v: number) => void; text: string; reference: string; books: Book[] }) {
  const navigate = useNavigate();
  const [alignment, setAlignment] = useState(false);
  const [menu, setMenu] = useState(false);
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
  const xref = useQuery({ queryKey: ["xref", slug, chapter], enabled: open && tab === "references", queryFn: () => data.xref(slug, chapter).catch(none({})) });
  const cites = useQuery({ queryKey: ["cites", slug, chapter], enabled: open && (tab === "commentary" || tab === "themes"), queryFn: () => data.concordance(slug, chapter).then((c) => c.cited_by).catch(none([] as Citation[])) });
  const taught = useTaughtPrecepts(open && tab === "precepts" ? slug : "", chapter);
  const precepts = preceptsForVerse(taught.data, verse).sort((a, b) => teacherRank(a.note.teacher) - teacherRank(b.note.teacher));
  const topicHits = useQuery({ queryKey: ["cites", slug, chapter], enabled: open && tab === "precepts", queryFn: () => data.concordance(slug, chapter).then((c) => c.cited_by).catch(none([] as Citation[])) });
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
  const said = useQuery({ queryKey: ["commentary", slug, chapter], enabled: open && tab === "commentary", queryFn: () => data.concordance(slug, chapter).then((c) => c.commentary ?? []).catch(none([] as VerseComment[])) });
  const breakdowns = (said.data ?? []).filter((c) => verseNumbers(c.verses).includes(verse)).sort((a, b) => teacherRank(a.note.teacher) - teacherRank(b.note.teacher) || b.note.date.localeCompare(a.note.date));
  // Every class that read this verse aloud, from the transcripts: Bishops first, then newest first.
  const readings = useReadings(open && tab === "commentary" ? slug : "", chapter);
  const readHere = readings.data?.[String(verse)] ?? [];
  const [allRead, setAllRead] = useState(false);
  const shown = new Set(breakdowns.map((c) => c.note.url));
  const also = [...new Map(comments.filter((c) => c.verses && !shown.has(c.url)).map((c) => [c.url, c] as const)).values()];
  const hasVerseContext = tab === "dictionary" || tab === "themes" || tab === "commentary";
  return (
    <Sheet open={open} onClose={onClose} snapPoints={[1]} background="reverse" className="bs-resources-sheet" title={reference} subTitle={TABS.find((t) => t.id === tab)?.subtitle} hasBack onBack={onClose}
      right={tab === "words" && verseWords ? <div className="bs-resmenu">
        <button type="button" className="bs-resmenu__btn" aria-label="More" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}><Feather name="more-vertical" size={18} color="var(--bs-default)" /></button>
        {menu ? <><div className="bs-dropdown__catch" onClick={() => setMenu(false)} /><div className="bs-resmenu__list" role="menu"><button type="button" role="menuitem" onClick={() => { setAlignment(!alignment); setMenu(false); }}>{alignment ? "Hide word alignment" : "Show word alignment"}</button></div></> : null}
      </div> : undefined}
      footer={
      <div className="bs-resfooter"><div className="bs-resfooter__scroll" role="tablist">
        {TABS.map((t) => <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} style={{ opacity: tab === t.id ? 1 : 0.3 }} onClick={() => setTab(t.id)}>
          {t.icon === "precepts" || t.icon === "users" ? <Feather name={t.icon} size={20} color={tab === t.id ? t.color : "var(--bs-grey)"} /> : <ResourceIcon kind={t.icon} size={20} color={tab === t.id ? t.color : "var(--bs-grey)"} />}
          <span>{t.label}</span>
        </button>)}
      </div></div>
    }>
      {tab === "words" && verseWords ? (
        <VerseLexicon verse={verse} words={verseWords} verses={verses} onVerse={onVerse} onOpen={setWord} onRead={onClose}>
          {alignment ? <div className="bs-vdetail__align"><WordAlignment words={verseWords} onWord={setWord} /></div> : null}
        </VerseLexicon>
      ) : null}
      {word ? <WordSheet number={word} open onClose={() => { setWord(null); onClose(); }} onBack={() => setWord(null)} books={books} here={{ slug, chapter, verse }} /> : null}
      {tab === "words" && verseWords ? null : <div className={hasVerseContext ? "bs-resource-panel" : undefined} data-fixed-context={tab === "dictionary" || tab === "themes" ? "" : undefined}>
        {hasVerseContext ? <ResourceVerseContext key={tab} verse={verse} verses={verses} onVerse={onVerse} text={text} /> : null}
        <div className="bs-resources">
        {hasVerseContext ? null : <p className="bs-resources__verse"><b>{verse}</b> {text}</p>}
        {tab === "words" ? (spans.isPending ? <p className="bs-loading">Loading...</p> : !verseWords ? (lxx.isPending ? <p className="bs-loading">Loading...</p> : greek ? (
          <div className="bs-greek">
            <p className="bs-resources__sub">The Greek of this verse</p>
            <p className="bs-greek__text" lang="grc">{greek}</p>
            <p className="bs-greek__src">Swete's Septuagint (1909), verse {verse} as Swete numbers it; the King James Apocrypha were translated from this Greek. Strong's numbers cover the 66 books only.</p>
          </div>
        ) : <p className="bs-loading">Strong's numbers cover the 66 books; this verse has none.</p>) : null) : null}
        {tab === "precepts" ? (taught.isError || topicHits.isError ? <Failed onRetry={() => { void taught.refetch(); void topicHits.refetch(); }} /> : taught.isPending ? <p className="bs-loading">Loading...</p> : !precepts.length && !topics.length ? <p className="bs-loading">No class has lined a precept up with this verse yet.</p> : <>
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
        {tab === "people" ? (named.isPending || everyone.isPending ? <p className="bs-loading">Loading...</p> : !here.length ? <p className="bs-loading">No one is named in this verse.</p> : here.map((p) => <button key={p.id} type="button" className="bs-resrow bs-resrow--person" onClick={() => { onClose(); navigate(`/person/${p.id}`); }}><EntityAvatar id={p.id} name={p.name} kind={avatarKind(p.type)} size={40} ink={avatarKind(p.type) === "female" ? "var(--bs-quart)" : "var(--bs-primary)"} base="var(--bs-reverse)" /><span><b>{p.name}</b><small>{p.description}{p.verses ? ` · named in ${p.verses} ${p.verses === 1 ? "verse" : "verses"}` : ""}</small></span></button>)) : null}
        {tab === "dictionary" ? (dict.isPending && words.length ? <p className="bs-loading">Loading...</p> : !dict.data?.length ? <p className="bs-loading">No dictionary entry for the words in this verse.</p> : dict.data.map((e) => <button key={e.slug} type="button" className="bs-resrow" onClick={() => { onClose(); navigate(`/dictionary/${e.slug}`); }}><b>{e.term}</b><small>{e.definitions[0]}</small></button>)) : null}
        {tab === "themes" ? (cites.isError ? <Failed onRetry={() => void cites.refetch()} /> : cites.isPending ? <p className="bs-loading">Loading...</p> : !themes.length ? <p className="bs-loading">No law, precept, case or topic cites this verse.</p> : themes.map((c) => <button key={c.url} type="button" className="bs-resrow" onClick={() => { onClose(); navigate(withFrom(toApp(c.url))); }}><b>{c.label}</b><small>{shelf(c.url, c.kind)}</small></button>)) : null}
        {tab === "references" ? (xref.isError ? <Failed onRetry={() => void xref.refetch()} /> : xref.isPending ? <p className="bs-loading">Loading...</p> : !refs.length ? <p className="bs-loading">No cross references for this verse.</p> : <div className="bs-resources__xrefs"><Xrefs refs={refs} books={books} /></div>) : null}
        {tab === "commentary" ? (cites.isError || said.isError ? <Failed onRetry={() => { void cites.refetch(); void said.refetch(); }} /> : cites.isPending || said.isPending ? <p className="bs-loading">Loading...</p> : !also.length && !breakdowns.length && !readHere.length ? <p className="bs-loading">No class or study note teaches from this verse yet.</p> : <>
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
      </div>}
    </Sheet>
  );
}

function ResourceVerseContext({ verse, verses, onVerse, text }: { verse: number; verses: number; onVerse: (v: number) => void; text: string }) {
  const layout = useRef<HTMLDivElement>(null);
  const passage = useRef<HTMLDivElement>(null);
  const direction = useRef(1);
  const previousHeight = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = passage.current;
    const box = layout.current;
    if (!el || !box || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timing = { easing: "ease-in-out" };
    const animations = [el.animate([{ opacity: 0, transform: `translateX(${direction.current * 10}px)` }, { opacity: 1, transform: "translateX(0)" }], { ...timing, duration: 180 })];
    if (previousHeight.current !== null) animations.push(box.animate([{ height: `${previousHeight.current}px` }, { height: `${el.offsetHeight}px` }], { ...timing, duration: 220 }));
    return () => animations.forEach(a => a.cancel());
  }, [verse]);
  const navigateVerse = (next: number) => {
    direction.current = next > verse ? 1 : -1;
    const el = passage.current;
    if (el && layout.current && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      previousHeight.current = layout.current.getBoundingClientRect().height;
      const old = el.cloneNode(true) as HTMLElement;
      old.inert = true;
      old.setAttribute("aria-hidden", "true");
      Object.assign(old.style, { position: "absolute", inset: "0 0 auto", pointerEvents: "none" });
      layout.current.append(old);
      old.animate([{ opacity: 1, transform: "translateX(0)" }, { opacity: 0, transform: `translateX(${-direction.current * 8}px)` }], { duration: 140, easing: "ease-in-out", fill: "forwards" }).finished.catch(() => {}).finally(() => old.remove());
    }
    onVerse(next);
  };
  return (
    <div className="bs-resource-context">
      <div ref={layout} className="bs-resource-context__layout">
        <div key={verse} ref={passage} className="bs-vdetail__verse">
          <div className="bs-vdetail__num"><span>{verse}</span></div>
          <p className="bs-resources__verse">{text.replace(/\n/g, "")}</p>
        </div>
      </div>
      <BibleVerseDetailFooter verse={verse} verses={verses} onVerse={navigateVerse} />
    </div>
  );
}

import { toAppPath } from "@shared/links.mjs";
const toApp = (sitePath: string) => toAppPath(sitePath) ?? sitePath;
/** A note opened right where it breaks down this passage, and a class's recording at that second. */
const passageLink = (c: VerseComment) => `${toApp(c.note.url)}${c.t ? `?t=${c.t}` : ""}#p-${c.passage.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;

/** A missing file means there is nothing for this chapter; any other failure is shown, with Retry. */
const none = <T,>(fallback: T) => (e: unknown): T => { if (e instanceof Error && e.message.startsWith("404 ")) return fallback; throw e; };
function Failed({ onRetry }: { onRetry: () => void }) {
  return <p className="bs-loading" role="status">This did not load. <button type="button" className="bs-link" onClick={onRetry}>Retry</button></p>;
}

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
