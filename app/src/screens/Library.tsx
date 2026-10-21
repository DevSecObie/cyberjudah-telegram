import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router";

import { compressVerses, data, fmtDate, type ConcordanceBook, type GlossaryEntry, type ResolvedRef, type ThreadStop } from "@/api/data";
import { Feather } from "@/bible/icons";
import { PALETTES } from "@/bible/theme";
import { useEndpointRelations, type EntryEndpoint } from "@/lib/relations";
import { haptic } from "@/tg/sdk";
import { AlphabetList, SectionTitle, firstLetter, sections, useHeaderOffset } from "@/ui/alphabet";
import { readableColor } from "@/ui/palette";
import { useAppTheme } from "@/ui/theme";
import { toAppPath } from "@shared/links.mjs";
import { share } from "@/lib/share";
import { useBackButton, useBottomButtons } from "@/tg/hooks";
import { useOpenInNewTab } from "@/ui/open-in-new-tab";
import { useSheet } from "@/ui/sheet";
import { useToast } from "@/ui/toast";
import { Chip, Chips, Empty, Icon, List, Row, Screen, SearchField, Section, Segmented, Skeleton } from "@/ui/ui";
import { EntityChipList } from "./tag-detail";
const toApp = (sitePath: string) => toAppPath(sitePath) ?? sitePath;

/** The law, the precepts, the cases, the topics, the study notes and the encyclopedia: the reference shelf. */

function Refs({ refs }: { refs: ResolvedRef[] }) {
  return (
    <div className="refs">{refs.map((r) => r.url ? <Link key={r.label} to={`/read/${r.slug}/${r.chapter}${r.verses ? `?v=${r.verses}` : ""}`}>{r.label}</Link> : <span key={r.label}>{r.label}</span>)}</div>
  );
}
function Quote({ r }: { r: ResolvedRef }) {
  return <blockquote className="verse-quote">{r.text.map((v) => <span key={v.verse}><sup>{v.verse}</sup>{v.text} </span>)}{r.more ? <em>… {r.more} more</em> : null}</blockquote>;
}

/**
 * Bible Strong's NaveListScreen, which our A–Z lists (the precepts and the topics) follow: the
 * rows of one letter filed under its disc, the alphabet along the bottom, and a search that
 * replaces the letters. The letter is kept in the address, so Back returns to it.
 */
function NaveList({ title, rows, tone, failed, retry }: { title: string; rows: { key: string; name: string; href: string }[] | undefined; tone: "quart" | "quint"; failed: boolean; retry: () => void }) {
  // The theme's own colour, darkened only where its white letter would not read (night's quart, the dark themes' quint).
  const color = readableColor(PALETTES[useAppTheme().name][tone], [[255, 255, 255]]);
  const [params, setParams] = useSearchParams();
  const letter = (params.get("letter") ?? "a").toLowerCase();
  const setLetter = (l: string) => setParams((p) => { const next = new URLSearchParams(p); next.set("letter", l); return next; }, { replace: true });
  const [q, setQ] = useState(params.get("q") ?? "");
  const needle = q.trim().toLowerCase();
  const shown = useMemo(() => (rows ?? []).filter((r) => (needle ? r.name.toLowerCase().includes(needle) : firstLetter(r.name) === letter)), [rows, needle, letter]);
  const top = useHeaderOffset();
  return (
    <Screen title={title} className="bs-list">
      <SearchField id={`${title.toLowerCase()}-q`} value={q} onChange={setQ} placeholder="Search by word" />
      {!rows && !failed ? <p className="bs-list__loading">Loading...</p> : failed && !rows ? (
        <Empty title={`The ${title.toLowerCase()} did not load`} action={{ label: "Retry", onClick: retry }}>Check your connection.</Empty>
      ) : shown.length ? (
        <div className="bs-list__body" style={{ ["--section-top" as string]: `${top}px` }}>
          {sections(shown, (r) => r.name).map((section) => (
            <section key={section.title}>
              <SectionTitle color={color} ink="white">{section.title.toUpperCase()}</SectionTitle>
              {section.data.map((r) => <Link key={r.key} to={r.href} className="bs-dictitem" onClick={() => haptic("select")}><span>{r.name}</span></Link>)}
            </section>
          ))}
        </div>
      ) : <Empty title="No word found..." />}
      {!q ? <AlphabetList color={color} letter={letter} setLetter={setLetter} /> : null}
    </Screen>
  );
}

/**
 * Bible Strong's NaveDetailTabScreen, which a precept's and a topic's page follow: the name in the
 * header with the ⋮ menu (share the link, copy the text, edit relations, open in a new tab), the
 * relations' chip, then the page. Loading, a failure with Retry, and nothing found have its states.
 */
function NaveDetail({ query, list, kind, page }: {
  query: { isPending: boolean; isError: boolean; refetch: () => unknown };
  list: string;
  kind: "precept" | "topic";
  page: { title: string; kicker: string; url: string; text: () => string; body: ReactNode } | null;
}) {
  const navigate = useNavigate();
  const sheet = useSheet();
  const toast = useToast();
  const openInNewTab = useOpenInNewTab();
  const endpoint = useMemo<EntryEndpoint | null>(() => (page ? { type: "entry", url: page.url, kind, label: page.title } : null), [page?.url, page?.title, kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const { count } = useEndpointRelations(endpoint);
  if (query.isPending) return <Screen title={list}><p className="bs-list__loading">Loading...</p></Screen>;
  if (query.isError) return <Screen title={list}><Empty title={`This ${kind} did not load`} action={{ label: "Retry", onClick: () => void query.refetch() }}>Check your connection.</Empty></Screen>;
  if (!page || !endpoint) return <Screen title={list}><Empty title={`Unable to load the ${kind}...`} /></Screen>;
  const relations = () => navigate(`/relations?endpoint=${encodeURIComponent(`entry:${endpoint.url}`)}&label=${encodeURIComponent(endpoint.label)}`);
  const menu = async () => {
    const a = await sheet.open({ items: [
      { id: "share", text: "Share the link", icon: <Feather name="share-2" size={16} /> },
      { id: "copy", text: "Copy the text", icon: <Feather name="copy" size={16} /> },
      { id: "relations", text: "Edit relations", icon: <Feather name="git-merge" size={16} /> },
      { id: "tab", text: "Open in new tab", icon: <Feather name="external-link" size={16} /> },
    ] });
    if (a?.id === "share") void share({ kind: "note", title: page.title, text: page.kicker, sitePath: page.url });
    else if (a?.id === "copy") { try { await navigator.clipboard.writeText(page.text()); toast("Copied to the clipboard."); } catch { toast("Error while sharing."); } }
    else if (a?.id === "relations") relations();
    else if (a?.id === "tab") openInNewTab(toApp(page.url));
  };
  return (
    <Screen title={page.title} kicker={page.kicker} className="nave-detail" action={<button type="button" className="icon-btn" aria-label="More options" title="More options" aria-haspopup="menu" onClick={() => void menu()}><Feather name="more-vertical" size={18} /></button>}>
      <div className="nave-detail__body">
        {count ? <div className="nave-detail__chips"><EntityChipList relationCount={count} onRelationPress={relations} /></div> : null}
        {page.body}
      </div>
    </Screen>
  );
}

export function Precepts() {
  useBackButton();
  const rows = useQuery({ queryKey: ["precepts"], queryFn: data.precepts });
  const list = useMemo(() => rows.data?.map((p) => ({ key: p.slug, name: p.title, href: toApp(p.url) })), [rows.data]);
  return <NaveList title="Precepts" rows={list} tone="quart" failed={rows.isError} retry={() => void rows.refetch()} />;
}

export function PreceptScreen() {
  const { slug = "" } = useParams();
  useBackButton();
  const p = useQuery({ queryKey: ["precept", slug], queryFn: () => data.precept(slug) });
  useBottomButtons(null, null);
  const d = p.data;
  return <NaveDetail query={p} list="Precepts" kind="precept" page={d ? {
    title: d.title, kicker: `Precept · ${d.refs.length} scriptures`, url: d.url,
    text: () => [d.title, ...d.refs.map((r) => [r.label, r.text.map((v) => v.text).join(" ")].filter(Boolean).join("\n"))].join("\n\n"),
    body: <List>{d.refs.map((r) => <div key={r.label} className="lawrow"><b>{r.label}{r.key ? " · key" : ""}</b>{r.text.length ? <Quote r={r} /> : null}<Refs refs={[r]} /></div>)}</List>,
  } : null} />;
}

export function Topics() {
  useBackButton();
  const rows = useQuery({ queryKey: ["topics"], queryFn: data.topics });
  const list = useMemo(() => rows.data?.filter((t) => (t.notes || t.cases) && !t.slug.startsWith("verdict-")).map((t) => ({ key: t.slug, name: t.label, href: toApp(t.url) })), [rows.data]);
  return <NaveList title="Topics" rows={list} tone="quint" failed={rows.isError} retry={() => void rows.refetch()} />;
}

export function TopicScreen() {
  const { slug = "" } = useParams();
  useBackButton();
  const t = useQuery({ queryKey: ["topic", slug], queryFn: () => data.topic(slug) });
  const d = t.data;
  const notes = d?.items.filter((i) => i.kind !== "case") ?? [], cases = d?.items.filter((i) => i.kind === "case") ?? [];
  const thread = d?.thread ?? [];
  return <NaveDetail query={t} list="Topics" kind="topic" page={d ? {
    title: d.label, kicker: "Topic", url: d.url,
    text: () => [d.label, ...thread.map((s) => `${s.label}\n${s.text}`), ...d.items.map((i) => i.title)].join("\n\n"),
    body: <>
      {thread.length ? <Section title="The Thread"><p className="hint">{thread.length} scriptures the classes opened on this, in Bible order. Tap one for the classes and the precepts read with it.</p><Thread stops={thread} /></Section> : null}
      {notes.length ? <Section title="Classes and Episodes"><List>{notes.map((i) => <Row key={i.url} href={i.url} meta={[i.kind === "captains" ? "Captains" : "Class", fmtDate(i.date), i.teacher].filter(Boolean).join(" · ")} title={i.title} />)}</List></Section> : null}
      {cases.length ? <Section title="Cases"><List>{cases.map((i) => <Row key={i.url} href={i.url} meta={i.verdict} title={i.title} sub={i.charge} />)}</List></Section> : null}
    </>,
  } : null} />;
}

/** A topic's scriptures in Bible order: each with the verse, the classes that opened it (the recording at that second) and the precepts read with it. */
function Thread({ stops }: { stops: ThreadStop[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const shown = all ? stops : stops.slice(0, 12);
  return (
    <ol className="thread">
      {shown.map((s) => {
        const k = `${s.book}|${s.chapter}|${s.verses}`, isOpen = open === k;
        const m = /^\/bible\/([a-z0-9-]+)\/(\d+)/.exec(s.url);
        const read = m ? `/read/${m[1]}/${m[2]}${s.verses ? `?v=${s.verses.split(/[-,]/)[0]}` : ""}` : s.url;
        return (
          <li key={k} className={`thread__stop${isOpen ? " thread__stop--open" : ""}`}>
            <button type="button" className="thread__head" onClick={() => { haptic("select"); setOpen(isOpen ? null : k); }} aria-expanded={isOpen}>
              <span className="thread__dot" />
              <span className="thread__ref"><b>{s.label}</b><small>{s.classes.length === 1 ? "1 class" : `${s.classes.length} classes`}{s.precepts.length ? ` · ${s.precepts.length} ${s.precepts.length === 1 ? "precept" : "precepts"}` : ""}</small></span>
            </button>
            <p className="thread__text">{s.text}</p>
            {isOpen ? <div className="thread__body">
              <Link to={read} className="thread__read"><Icon name="book" size={14} /> Read {s.label}</Link>
              {s.classes.map((c) => <Link key={`${c.url}${c.ts}`} to={`${toApp(c.url)}${c.t ? `?t=${c.t}` : ""}`} className="thread__class"><span className="thread__ts">{c.ts || "notes"}</span><span><b>{c.title}</b><small>{[fmtDate(c.date), c.teacher].filter(Boolean).join(" · ")}</small></span></Link>)}
              {s.precepts.length ? <div className="thread__precepts">{s.precepts.map((p) => { const pm = /^\/bible\/([a-z0-9-]+)\/(\d+)(?:#v(\d+))?/.exec(p.url); return <Link key={p.label} to={pm ? `/read/${pm[1]}/${pm[2]}${pm[3] ? `?v=${pm[3]}` : ""}` : "/bible"} className="chip">{p.label}</Link>; })}</div> : null}
            </div> : null}
          </li>
        );
      })}
      {!all && stops.length > 12 ? <li className="thread__more"><button type="button" onClick={() => setAll(true)}>All {stops.length} scriptures</button></li> : null}
    </ol>
  );
}

/** 4 Chapters a Day: the study notes, by book, with the reading plan's next chapter first. */
export function Study() {
  useBackButton();
  const notes = useQuery({ queryKey: ["notes"], queryFn: data.notes });
  const [q, setQ] = useState("");
  const studies = (notes.data ?? []).filter((n) => n.kind === "study" && (!q || n.title.toLowerCase().includes(q.toLowerCase())));
  const byBook = new Map<string, typeof studies>();
  for (const n of studies) { const k = n.book ?? "Other"; byBook.set(k, [...(byBook.get(k) ?? []), n]); }
  return (
    <Screen title="4 Chapters a Day" kicker={`${studies.length} chapters written up`}>
      <SearchField id="study-q" value={q} onChange={setQ} placeholder="A book or a chapter" />
      {notes.isPending ? <Skeleton rows={10} /> : [...byBook.entries()].map(([book, rows]) => <Section key={book} title={book}><List>{rows.sort((a, b) => (a.chapters?.[0] ?? 0) - (b.chapters?.[0] ?? 0)).map((n) => <Row key={n.url} href={n.url} meta={n.range} title={n.title.replace(/^[^:]+:\s*/, "")} />)}</List></Section>)}
    </Screen>
  );
}

export function Encyclopedia() {
  useBackButton();
  const rows = useQuery({ queryKey: ["encyclopedia"], queryFn: data.encyclopedia });
  return (
    <Screen title="Encyclopedia" kicker="Standing subjects, walked through book by book">
      {rows.isPending ? <Skeleton rows={8} /> : <List>{(rows.data ?? []).map((e) => <Row key={e.slug} href={e.url} title={e.title} sub={e.summary} />)}</List>}
    </Screen>
  );
}

/** A site chapter link ("/bible/exodus/17#v16") as the reader's own ("/read/exodus/17?v=16"). */
const readPath = (url: string) => {
  const m = /^\/bible\/([a-z0-9-]+)\/(\d+)(?:#v(\d+))?/.exec(url);
  return m ? `/read/${m[1]}/${m[2]}${m[3] ? `?v=${m[3]}` : ""}` : toApp(url);
};
const clock = (sec: number) => {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = String(sec % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
};
const glossaryHit = (e: GlossaryEntry, q: string) =>
  e.term.toLowerCase().includes(q) || e.aliases.some((a) => a.toLowerCase().includes(q)) || e.definition.toLowerCase().includes(q);

/** The words the classes use, A to Z: each defined, with its scripture, where to read more, and the moments it is taught. */
export function Glossary() {
  useBackButton();
  const location = useLocation();
  const g = useQuery({ queryKey: ["glossary"], queryFn: data.glossary, staleTime: 3_600_000 });
  const [q, setQ] = useState("");
  const entries = g.data?.entries ?? [];
  const hits = useMemo(() => { const lc = q.trim().toLowerCase(); return lc ? entries.filter((e) => glossaryHit(e, lc)) : entries; }, [entries, q]);
  const letters = useMemo(() => {
    const m = new Map<string, GlossaryEntry[]>();
    for (const e of [...hits].sort((a, b) => a.term.localeCompare(b.term))) { const l = /[a-z]/i.test(e.term[0]) ? e.term[0].toUpperCase() : "#"; m.set(l, [...(m.get(l) ?? []), e]); }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [hits]);
  // A word linked from the site or a search ("/glossary#amalek") is brought into view once per visit.
  const went = useRef("");
  useEffect(() => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (!g.data || !id || went.current === location.key) return;
    // After the screen's own scroll reset on navigation, as the note screen does; marked done only once it has moved.
    const t = setTimeout(() => { const el = document.getElementById(`gl-${id}`); if (!el) return; went.current = location.key; el.scrollIntoView({ block: "start" }); }, 120);
    return () => clearTimeout(t);
  }, [g.data, location.hash, location.key]);
  if (g.isPending) return <Screen title="Glossary"><Skeleton rows={10} /></Screen>;
  if (g.isError) return <Screen title="Glossary"><Empty title="The glossary did not load" action={{ label: "Try again", onClick: () => void g.refetch() }}>Check your connection.</Empty></Screen>;
  if (!entries.length) return <Screen title="Glossary"><Empty title="The glossary is being written" action={{ label: "Open the precepts", href: "/precepts" }}>Meanwhile, the precepts gather what scripture says on each subject.</Empty></Screen>;
  return (
    <Screen title="Glossary" kicker={g.data?.about || "The words the classes use, defined from the teachings and the King James text"}>
      <SearchField id="gl-q" value={q} onChange={setQ} placeholder="Find a word" />
      {!hits.length ? <Empty title="No word matches" /> : letters.map(([l, list]) => (
        <Section key={l} title={l}>
          <List>{list.map((e) => <GlossaryItem key={e.slug} e={e} />)}</List>
        </Section>
      ))}
    </Screen>
  );
}

function GlossaryItem({ e }: { e: GlossaryEntry }) {
  return (
    <div className="lawrow glossary" id={`gl-${e.slug}`}>
      <b>{e.term}</b>{e.aliases.length ? <span className="glossary__aliases"> · also {e.aliases.join(", ")}</span> : null}
      <p>{e.definition}</p>
      {e.scripture.length ? <div className="refs">{e.scripture.map((r) => <Link key={r.label} to={readPath(r.url)}>{r.label}</Link>)}</div> : null}
      {e.see.length ? <div className="refs">{e.see.map((r) => <Link key={r.url} to={toApp(r.url)}>See {r.title}</Link>)}</div> : null}
      {e.taught.length ? <div className="glossary__taught">{e.taught.map((t) => <Link key={`${t.video}@${t.seconds}`} className="chip" to={`/watch/${t.video}?t=${t.seconds}`} aria-label={`${t.title} at ${clock(t.seconds)}`}><Icon name="play" size={12} /> {t.title.length > 34 ? `${t.title.slice(0, 32)}…` : t.title} · {clock(t.seconds)}</Link>)}</div> : null}
    </div>
  );
}

/** The concordance's shelves, in the site's order: what cites a chapter, grouped by what it is. */
const CITED_GROUPS: [label: string, test: (c: { kind: string; url: string }) => boolean][] = [
  ["Notes and classes", (c) => !["law", "precept", "case"].includes(c.kind) && !/^\/(encyclopedia|law|precepts|cases)\//.test(c.url)],
  ["Encyclopedia", (c) => c.url.startsWith("/encyclopedia/")],
  ["Cases", (c) => c.kind === "case" || c.url.startsWith("/cases/")],
  ["Precepts", (c) => c.kind === "precept" || c.url.startsWith("/precepts/")],
  ["Laws", (c) => c.kind === "law" || c.url.startsWith("/law/")],
];
const verseList = (vv: string[]) => compressVerses(vv.flatMap((v) => { const [a, b = a] = v.split("-").map(Number); return Number.isFinite(a) && Number.isFinite(b) && b >= a ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : []; })).replace(/,/g, ", ");

/** The concordance, book by book: how much of each book the library cites. */
export function Concordance() {
  useBackButton();
  const rows = useQuery({ queryKey: ["concordance-index"], queryFn: data.concordanceIndex, staleTime: 3_600_000 });
  const [q, setQ] = useState("");
  if (rows.isError) return <Screen title="Concordance"><Empty title="The concordance did not load" action={{ label: "Try again", onClick: () => void rows.refetch() }}>Check your connection.</Empty></Screen>;
  const list = (rows.data ?? []).filter((r) => !q || r.book.toLowerCase().includes(q.toLowerCase()));
  const testaments = [...new Set(list.map((r) => r.testament))];
  return (
    <Screen title="Concordance" kicker="Every chapter, with everything in the library that cites it">
      <SearchField id="conc-q" value={q} onChange={setQ} placeholder="Find a book" />
      {rows.isPending ? <Skeleton rows={12} /> : testaments.map((t) => (
        <Section key={t} title={t}>
          <List>{list.filter((r) => r.testament === t).map((r) => <Row key={r.slug} href={`/concordance/${r.slug}`} title={r.book} trailing={<span className="row__count">{r.cited.length ? `${r.cited.length} of ${r.chapters}` : "none"}</span>} />)}</List>
        </Section>
      ))}
    </Screen>
  );
}

/** One book's concordance: each cited chapter, and what cites it, grouped by shelf with the verses. */
export function ConcordanceBookScreen() {
  const { book = "" } = useParams();
  const location = useLocation();
  useBackButton();
  const b = useQuery({ queryKey: ["concordance-book", book], queryFn: () => data.concordanceBook(book), staleTime: 3_600_000 });
  // "/concordance/genesis#ch-3" lands on chapter 3, once per visit.
  const went = useRef("");
  useEffect(() => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (!b.data || !id || went.current === location.key) return;
    const t = setTimeout(() => { const el = document.getElementById(`conc-${id}`); if (!el) return; went.current = location.key; el.scrollIntoView({ block: "start" }); }, 120);
    return () => clearTimeout(t);
  }, [b.data, location.hash, location.key]);
  if (b.isPending) return <Screen title="…"><Skeleton rows={10} /></Screen>;
  if (!b.data) return <Screen title="Concordance"><Empty title="This book did not load" action={{ label: "All books", href: "/concordance" }} /></Screen>;
  const d: ConcordanceBook = b.data;
  return (
    <Screen title={d.book} kicker={`Concordance · ${d.citations} citations into ${d.cited.length} of ${d.chapters} chapters`}>
      {!d.chapterRows.length ? <Empty title={`Nothing in the library cites ${d.book} yet`} action={{ label: `Read ${d.book}`, href: `/read/${d.slug}/1` }} /> : d.chapterRows.map((ch) => (
        <section key={ch.chapter} className="section conc-ch" id={`conc-ch-${ch.chapter}`}>
          <div className="section__head"><h2><Link to={`/read/${d.slug}/${ch.chapter}`}>{d.book} {ch.chapter}</Link></h2><span className="row__count">{ch.cited_by.length}</span></div>
          {CITED_GROUPS.map(([label, test]) => {
            const rows = ch.cited_by.filter(test);
            return rows.length ? <List key={label}>{rows.map((r) => <Row key={r.kind + r.url} href={toApp(r.url)} meta={label} title={r.label} sub={r.verses.length ? `v. ${verseList(r.verses)}` : undefined} />)}</List> : null;
          })}
        </section>
      ))}
    </Screen>
  );
}
