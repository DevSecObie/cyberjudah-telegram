import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router";

import { data, fmtDate, type GlossaryEntry, type ResolvedRef, type ThreadStop } from "@/api/data";
import { haptic } from "@/tg/sdk";
import { toAppPath } from "@shared/links.mjs";
import { share } from "@/lib/share";
import { useBackButton, useBottomButtons } from "@/tg/hooks";
import { Chip, Chips, Empty, Icon, List, Row, Screen, SearchField, Section, Segmented, Skeleton } from "@/ui/ui";
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

export function Precepts() {
  useBackButton(false);
  const rows = useQuery({ queryKey: ["precepts"], queryFn: data.precepts });
  const [q, setQ] = useState("");
  const list = (rows.data ?? []).filter((p) => !q || p.title.toLowerCase().includes(q.toLowerCase()));
  return (
    <Screen title="Precepts" kicker="Every subject scripture speaks to, A to Z">
      <SearchField id="pr-q" value={q} onChange={setQ} placeholder="Find a precept" />
      {rows.isPending ? <Skeleton rows={12} /> : <List>{list.slice(0, 300).map((p) => <Row key={p.slug} href={p.url} title={p.title} trailing={<span className="row__count">{p.refs}</span>} />)}</List>}
    </Screen>
  );
}

export function PreceptScreen() {
  const { slug = "" } = useParams();
  useBackButton(false);
  const p = useQuery({ queryKey: ["precept", slug], queryFn: () => data.precept(slug) });
  useBottomButtons(p.data ? { text: "Share", onClick: () => void share({ kind: "note", title: `Precept: ${p.data!.title}`, text: `${p.data!.refs.length} scriptures · CyberJudah`, sitePath: p.data!.url }) } : null);
  if (p.isPending) return <Screen title="…"><Skeleton /></Screen>;
  if (!p.data) return <Screen title="Precept"><Empty title="This precept did not load" /></Screen>;
  return (
    <Screen title={p.data.title} kicker={`Precept · ${p.data.refs.length} scriptures`}>
      <List>{p.data.refs.map((r) => <div key={r.label} className="lawrow"><b>{r.label}{r.key ? " · key" : ""}</b>{r.text.length ? <Quote r={r} /> : null}<Refs refs={[r]} /></div>)}</List>
    </Screen>
  );
}

export function Topics() {
  useBackButton(false);
  const rows = useQuery({ queryKey: ["topics"], queryFn: data.topics });
  const [q, setQ] = useState("");
  const list = (rows.data ?? []).filter((t) => (t.notes || t.cases) && !t.slug.startsWith("verdict-") && (!q || t.label.toLowerCase().includes(q.toLowerCase())));
  return (
    <Screen title="Topics" kicker="Classes and episodes by what they cover">
      <SearchField id="topic-q" value={q} onChange={setQ} placeholder="Find a topic" />
      {rows.isPending ? <Skeleton rows={12} /> : <List>{list.map((t) => <Row key={t.slug} href={t.url} title={t.label} trailing={<span className="row__count">{t.notes + t.cases}</span>} />)}</List>}
    </Screen>
  );
}

export function TopicScreen() {
  const { slug = "" } = useParams();
  useBackButton(false);
  const t = useQuery({ queryKey: ["topic", slug], queryFn: () => data.topic(slug) });
  if (t.isPending) return <Screen title="…"><Skeleton /></Screen>;
  if (!t.data) return <Screen title="Topic"><Empty title="This topic did not load" /></Screen>;
  const notes = t.data.items.filter((i) => i.kind !== "case"), cases = t.data.items.filter((i) => i.kind === "case");
  const thread = t.data.thread ?? [];
  return (
    <Screen title={t.data.label} kicker="Topic">
      {thread.length ? <Section title="The Thread"><p className="hint">{thread.length} scriptures the classes opened on this, in Bible order. Tap one for the classes and the precepts read with it.</p><Thread stops={thread} /></Section> : null}
      {notes.length ? <Section title="Classes and Episodes"><List>{notes.map((i) => <Row key={i.url} href={i.url} meta={[i.kind === "captains" ? "Captains" : "Class", fmtDate(i.date), i.teacher].filter(Boolean).join(" · ")} title={i.title} />)}</List></Section> : null}
      {cases.length ? <Section title="Cases"><List>{cases.map((i) => <Row key={i.url} href={i.url} meta={i.verdict} title={i.title} sub={i.charge} />)}</List></Section> : null}
    </Screen>
  );
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
  useBackButton(false);
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
  useBackButton(false);
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
  useBackButton(false);
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
