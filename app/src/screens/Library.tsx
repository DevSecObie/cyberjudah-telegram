import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";

import { data, fmtDate, type ResolvedRef, type ThreadStop } from "@/api/data";
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

export function LawIndex() {
  useBackButton(false);
  const { part } = useParams();
  const laws = useQuery({ queryKey: ["laws"], queryFn: data.laws });
  const [q, setQ] = useState("");
  const parts = (laws.data ?? []).filter((p) => !part || p.url.endsWith(`/${part}`));
  const lc = q.toLowerCase();
  return (
    <Screen title="The Law" kicker="The handbook of Bible law">
      <SearchField id="law-q" value={q} onChange={setQ} placeholder="Find a section" />
      {laws.isPending ? <Skeleton rows={8} /> : parts.map((p) => {
        const secs = p.sections.filter((s) => !lc || `${s.id} ${s.title} ${p.title}`.toLowerCase().includes(lc)); if (!secs.length) return null;
        return <Section key={p.n} title={`${p.n}. ${p.title}`}><List>{secs.map((s) => <Row key={s.id} href={s.url} meta={s.id} title={s.title} trailing={<span className="row__count">{s.laws}</span>} />)}</List></Section>;
      })}
    </Screen>
  );
}

export function LawSectionScreen() {
  const { section = "" } = useParams();
  useBackButton(false);
  const sec = useQuery({ queryKey: ["law", section], queryFn: () => data.law(section) });
  useBottomButtons(sec.data ? { text: "Share", onClick: () => void share({ kind: "note", title: `${sec.data!.id} ${sec.data!.title}`, text: "The handbook of Bible law · CyberJudah", sitePath: sec.data!.url }) } : null);
  if (sec.isPending) return <Screen title="…"><Skeleton /></Screen>;
  if (!sec.data) return <Screen title="Law"><Empty title="This section did not load" /></Screen>;
  const s = sec.data;
  return (
    <Screen title={s.title} kicker={`${s.id} · ${s.part.title}`}>
      <List>{s.entries.map((e) => <div key={e.id} className="lawrow"><b>{e.id}</b><p>{e.text}</p><Refs refs={e.refs} />{e.refs[0]?.text?.length ? <Quote r={e.refs[0]} /> : null}</div>)}</List>
      {s.caseRefs?.length ? <Section title="Cases under this law"><List>{s.caseRefs.map((c) => <Row key={c.slug} href={c.url} meta={c.verdict} title={c.name} sub={c.charge} />)}</List></Section> : null}
      {s.seeAlso.length ? <Section title="See also"><List>{s.seeAlso.map((x) => x.url ? <Row key={x.id} href={x.url} meta={x.id} title={x.title} /> : null)}</List></Section> : null}
    </Screen>
  );
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

export function Cases() {
  useBackButton(false);
  const [params, setParams] = useSearchParams();
  const kind = params.get("kind") === "blessing" ? "blessing" : params.get("kind") === "judgment" ? "judgment" : "all";
  const era = params.get("era") ?? "";
  const idx = useQuery({ queryKey: ["cases"], queryFn: data.cases });
  const [q, setQ] = useState("");
  const list = useMemo(() => (idx.data?.cases ?? []).filter((c) => (kind === "all" || c.kind === kind) && (!era || c.era === era) && (!q || `${c.name} ${c.charge} ${c.verdict}`.toLowerCase().includes(q.toLowerCase()))), [idx.data, kind, era, q]);
  const set = (k: string, v: string) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p, { replace: true }); };
  return (
    <Screen title="Case studies" kicker="The judgments, and the blessings">
      <Segmented label="Kind" value={kind} onChange={(v) => set("kind", v === "all" ? "" : v)} options={[["all", "All"], ["judgment", "Judgments"], ["blessing", "Blessings"]]} />
      <SearchField id="case-q" value={q} onChange={setQ} placeholder="A name, a charge, a verdict" />
      {idx.data ? <Chips><Chip on={!era} onClick={() => set("era", "")}>Every era</Chip>{idx.data.eras.map((e) => <Chip key={e} on={era === e} onClick={() => set("era", era === e ? "" : e)}>{e}</Chip>)}</Chips> : null}
      {idx.isPending ? <Skeleton rows={10} /> : !list.length ? <Empty title="No case matches" /> : <List>{list.slice(0, 200).map((c) => <Row key={c.slug} href={c.url} meta={`${c.era} · ${c.verdict}`} title={c.name} sub={c.charge} trailing={<span className={`pill ${c.kind === "blessing" ? "pill--ok" : "pill--hot"}`}>{c.kind === "blessing" ? "blessed" : "judged"}</span>} />)}</List>}
    </Screen>
  );
}

export function CaseScreen() {
  const { slug = "" } = useParams();
  useBackButton(false);
  const c = useQuery({ queryKey: ["case", slug], queryFn: () => data.case(slug) });
  useBottomButtons(c.data ? { text: "Share", onClick: () => void share({ kind: "note", title: `${c.data!.name}: ${c.data!.charge}`, text: `${c.data!.verdictLabel ?? c.data!.verdict} · CyberJudah case study`, sitePath: c.data!.url }) } : null);
  if (c.isPending) return <Screen title="…"><Skeleton /></Screen>;
  if (!c.data) return <Screen title="Case"><Empty title="This case did not load" /></Screen>;
  const k = c.data;
  return (
    <Screen title={k.name} kicker={`${k.era} · ${k.verdictLabel ?? k.verdict}`}>
      <div className="card"><p className="card__label">The charge</p><p className="verse" style={{ fontSize: 19 }}>{k.charge}</p></div>
      <Section title="What happened"><p className="note" style={{ margin: 0 }}>{k.summary || k.offense}</p></Section>
      <Section title="The judgment"><p className="note" style={{ margin: 0 }}>{k.judgment}</p></Section>
      {k.refsResolved?.length ? <Section title="Scripture"><List>{k.refsResolved.map((r) => <div key={r.label} className="lawrow"><b>{r.label}</b>{r.text.length ? <Quote r={r} /> : null}<Refs refs={[r]} /></div>)}</List></Section> : null}
      {k.lawsResolved?.length ? <Section title="The laws"><List>{k.lawsResolved.map((l) => l.url ? <Row key={l.id} href={l.url} meta={l.id} title={l.text} /> : <div key={l.id} className="lawrow"><b>{l.id}</b><p>{l.text}</p></div>)}</List></Section> : null}
      {k.preceptsResolved?.length ? <Section title="Precepts"><Chips>{k.preceptsResolved.map((p) => p.url ? <Link key={p.slug} className="chip" to={`/precepts/${p.slug}`}>{p.title}</Link> : null)}</Chips></Section> : null}
      {k.relatedCases?.length ? <Section title="Related cases"><List>{k.relatedCases.map((r) => <Row key={r.slug} href={`/cases/${k.era.toLowerCase().replace(/[^a-z0-9]+/g, "-")}/${r.slug}`} title={r.name} sub={r.desc} />)}</List></Section> : null}
      {k.taught?.length ? <Section title="Taught in"><List>{k.taught.map((t) => <Row key={t.url} href={t.url} meta={t.range} title={t.title} />)}</List></Section> : null}
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
      {thread.length ? <Section title="The thread"><p className="hint">{thread.length} scriptures the classes opened on this, in Bible order. Tap one for the classes and the precepts read with it.</p><Thread stops={thread} /></Section> : null}
      {notes.length ? <Section title="Classes and episodes"><List>{notes.map((i) => <Row key={i.url} href={i.url} meta={[i.kind === "captains" ? "Captains" : "Class", fmtDate(i.date), i.teacher].filter(Boolean).join(" · ")} title={i.title} />)}</List></Section> : null}
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
