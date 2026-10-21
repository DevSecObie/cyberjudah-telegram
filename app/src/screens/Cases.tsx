import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router";

import { data, type Case, type CaseRow, type ResolvedRef } from "@/api/data";
import { Feather } from "@/bible/icons";
import { useKeptScroll, useVisitState } from "@/lib/place";
import { share } from "@/lib/share";
import { useBackButton } from "@/tg/hooks";
import { haptic } from "@/tg/sdk";
import { avatarKind, EntityAvatar } from "@/ui/avatar";
import { RefText } from "@/ui/reftext";
import { ScriptureCard } from "@/ui/scripture";
import { useHeaderOffset } from "@/ui/alphabet";
import { FiltersButton } from "@/ui/panel";
import { Empty, List, Row, Screen, SearchField } from "@/ui/ui";

/**
 * The case studies: the judgments recorded in scripture, and those who kept the law and were
 * blessed. The list goes era by era; a case reads from the charge down: what happened, who it
 * concerns, the offense (or what was kept) and the judgment (or the blessing), the scripture with
 * its text, then the law, the precepts, the cases like it and where the classes taught it.
 */
const verdictName = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);
const kindName = (k: CaseRow["kind"]) => (k === "blessing" ? "Blessing" : "Judgment");

const KINDS = [["all", "All"], ["judgment", "Judgments"], ["blessing", "Blessings"]] as const;

/**
 * The case studies as Bible Strong's CommentaryLibraryScreen: the title with the filter button
 * (Bible Strong's FiltersHeader: the kind, the era), the search field under it as the Lexicon has,
 * then a section per era, its name on a grey band held at the top, a row per case.
 */
export function Cases() {
  useBackButton();
  const [params, setParams] = useSearchParams();
  const kind = params.get("kind") === "blessing" ? "blessing" : params.get("kind") === "judgment" ? "judgment" : "all";
  const era = params.get("era") ?? "";
  const idx = useQuery({ queryKey: ["cases"], queryFn: data.cases, staleTime: Infinity, retry: 1 });
  const [q, setQ] = useVisitState("q", "");
  useKeptScroll(!!idx.data);
  const top = useHeaderOffset();
  const all = idx.data?.cases ?? [];
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter((c) => (kind === "all" || c.kind === kind) && (!era || c.era === era) && (!needle || `${c.name} ${c.charge} ${c.verdict} ${c.code ?? ""}`.toLowerCase().includes(needle)));
  }, [all, kind, era, q]);
  const set = (k: string, v: string) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p, { replace: true }); };
  const groups = useMemo(() => (idx.data?.eras ?? []).map((e) => [e, list.filter((c) => c.era === e)] as const).filter(([, rows]) => rows.length), [idx.data, list]);
  const count = (k: string) => (k === "all" ? all.length : all.filter((c) => c.kind === k).length);
  const filters = (
    <FiltersButton onReset={() => setParams(new URLSearchParams(), { replace: true })} filters={[
      { key: "kind", icon: "layers", label: "Kind", value: KINDS.find(([k]) => k === kind)![1], active: kind !== "all", options: KINDS.map(([k, label]) => ({ key: k, label: idx.data ? `${label} (${count(k)})` : label, selected: kind === k, onSelect: () => set("kind", k === "all" ? "" : k) })) },
      { key: "era", icon: "clock", label: "Era", value: era || "Every era", active: !!era, options: [{ key: "", label: "Every era", selected: !era, onSelect: () => set("era", "") }, ...(idx.data?.eras ?? []).map((e) => ({ key: e, label: e, selected: era === e, onSelect: () => set("era", e) }))] },
    ]} />
  );

  return (
    <Screen className="cases" title="Case studies" action={filters}>
      <SearchField id="case-q" value={q} onChange={setQ} placeholder="A name, a charge, a verdict" />
      {idx.isPending ? <p className="bs-list__loading">Loading...</p> : idx.isError ? (
        <Empty title="The case studies did not load" action={{ label: "Retry", onClick: () => void idx.refetch() }} />
      ) : !list.length ? (
        <Empty title="No case found...">Try a name, a charge or another era.</Empty>
      ) : (
        <div className="cases__body" style={{ ["--section-top" as string]: `${top}px` }}>
          {groups.map(([e, rows]) => (
            <section key={e} aria-label={e}>
              <h2 className="cases__era">{e}</h2>
              {rows.map((c) => <CaseListRow key={c.slug} c={c} />)}
            </section>
          ))}
        </div>
      )}
    </Screen>
  );
}

/** Bible Strong's CommentaryLibraryItem: the name in bold over two lines, then a grey line, here the charge. */
function CaseListRow({ c }: { c: CaseRow }) {
  return (
    <Link to={c.url} className="caserow" onClick={() => haptic("select")}>
      <b className="caserow__name">{c.name}</b>
      <span className="caserow__charge">{c.charge}</span>
    </Link>
  );
}

const SCRIPTURE_FIRST = 4, SCRIPTURE_MORE = 6, SHOWN_VERSES = 8;

export function CaseScreen() {
  const { slug = "" } = useParams();
  useBackButton();
  const c = useQuery({ queryKey: ["case", slug], queryFn: () => data.case(slug), staleTime: Infinity, retry: 1 });
  const people = useQuery({ queryKey: ["people-index"], queryFn: data.people, staleTime: Infinity });
  const [shown, setShown] = useVisitState("scripture", SCRIPTURE_FIRST);
  useKeptScroll(!!c.data);

  if (c.isPending) return <Screen className="case"><CaseSkeleton /></Screen>;
  if (c.isError || !c.data) return (
    <Screen className="case">
      <Empty title="This case did not load" action={{ label: "Try again", onClick: () => void c.refetch() }}>Check your connection, or <Link to="/cases">browse every case</Link>.</Empty>
    </Screen>
  );
  const k: Case = c.data;
  const blessing = k.kind === "blessing";
  const offense = k.offenseFull?.length ? k.offenseFull : [k.offense].filter(Boolean);
  const judgment = k.judgmentFull?.length ? k.judgmentFull : [k.judgment].filter(Boolean);
  const refs = (k.refsResolved ?? []).filter((r) => r.slug && r.text.length);
  const typeOf = new Map((people.data ?? []).map((p) => [p.id, p.type]));
  const related = (k.related ?? []).filter((r) => r.url);

  return (
    <Screen className="case">
      <header className="case__head">
        <div className="case__top">
          <p className="case__eyebrow" data-kind={k.kind}>{[kindName(k.kind), k.era, k.code].filter(Boolean).join(" · ")}</p>
          <button type="button" className="case__share" onClick={() => { haptic("select"); void share({ kind: "note", title: `${k.name}: ${k.charge}`, text: `${k.verdictLabel ?? k.verdict} · CyberJudah case study`, sitePath: k.url }); }}><Feather name="share-2" size={14} color="currentColor" />Share</button>
        </div>
        <h1 className="case__title">{k.name}</h1>
        <p className="case__verdict" data-kind={k.kind}><i aria-hidden="true" />{k.verdictLabel ?? verdictName(k.verdict)}</p>
      </header>

      <blockquote className="case__charge"><span>{blessing ? "What was kept" : "The charge"}</span>{k.charge}</blockquote>
      {k.summary ? <p className="case__lead"><RefText text={k.summary} /></p> : null}

      {k.people?.length ? (
        <CaseSection title="People in this case">
          <ul className="case__people">
            {k.people.map((p) => (
              <li key={p.id}><Link to={`/person/${p.id}`} className="case__person" onClick={() => haptic("select")}><EntityAvatar id={p.id} name={p.name} kind={avatarKind(typeOf.get(p.id))} size={32} /><span>{p.name}</span><Feather name="chevron-right" size={14} color="currentColor" /></Link></li>
            ))}
          </ul>
        </CaseSection>
      ) : null}

      {offense.length ? <CaseSection title={blessing ? "The obedience" : "The offense"}><Prose paragraphs={offense} /></CaseSection> : null}
      {judgment.length ? <CaseSection title={blessing ? "The blessing" : "The judgment"}><Prose paragraphs={judgment} /></CaseSection> : null}

      {refs.length ? (
        <CaseSection title="Scripture" count={refs.length}>
          <div className="entity__cards">
            {refs.slice(0, shown).map((r) => <CaseScripture key={r.label} r={r} />)}
          </div>
          {shown < refs.length ? <button type="button" className="entity__more" onClick={() => { haptic("select"); setShown(Math.min(refs.length, shown + SCRIPTURE_MORE)); }}>Show {Math.min(SCRIPTURE_MORE, refs.length - shown)} more<span> · {refs.length - shown} left</span></button> : null}
        </CaseSection>
      ) : null}

      {k.lawsResolved?.length ? (
        <CaseSection title="The law">
          <List>{k.lawsResolved.map((l) => l.url ? <Row key={l.id} href={l.url} meta={l.id} title={l.text} /> : <div key={l.id} className="lawrow"><b>{l.id}</b><p>{l.text}</p></div>)}</List>
        </CaseSection>
      ) : null}

      {k.preceptsResolved?.some((p) => p.url) ? (
        <CaseSection title="Precepts">
          <div className="case__chips">{k.preceptsResolved.filter((p) => p.url).map((p) => <Link key={p.slug} className="chip" to={`/precepts/${p.slug}`} onClick={() => haptic("select")}>{p.title}</Link>)}</div>
        </CaseSection>
      ) : null}

      {related.length ? (
        <CaseSection title="Related cases">
          <div className="entity__cards">{related.map((r) => <CaseCard key={r.slug} to={r.url!} name={r.name} preview={r.desc || r.charge} />)}</div>
        </CaseSection>
      ) : null}

      {k.taught?.length ? (
        <CaseSection title="Taught in">
          <List>{k.taught.map((t) => <Row key={t.url} href={t.url} meta={t.range} title={t.title} />)}</List>
        </CaseSection>
      ) : null}

      {k.see?.length ? (
        <CaseSection title="See also">
          <List>{k.see.map((s) => <Row key={s.url} href={s.url} title={s.title} />)}</List>
        </CaseSection>
      ) : null}
    </Screen>
  );
}

/** A section of a case: a hairline, an eyebrow title, the content (as a person's page has). */
function CaseSection({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="entity__section" aria-label={title}>
      <h2 className="entity__eyebrow">{title}{count ? <span> · {count}</span> : null}</h2>
      {children}
    </section>
  );
}

function Prose({ paragraphs }: { paragraphs: string[] }) {
  return <div className="case__prose">{paragraphs.map((p, i) => <p key={i}><RefText text={p} /></p>)}</div>;
}

/** One of the case's passages as a scripture card: the first verses of a long one, all of it in the reader. */
function CaseScripture({ r }: { r: ResolvedRef }) {
  const [open, setOpen] = useState(false);
  const verses = r.text;
  const at = { slug: r.slug!, chapter: r.chapter, from: verses[0].verse, to: verses[verses.length - 1].verse };
  const href = `/read/${r.slug}/${r.chapter}${r.verses ? `?v=${r.verses.replace(/\s+/g, "")}` : ""}`;
  const long = verses.length > SHOWN_VERSES;
  return (
    <ScriptureCard at={at} label={r.label} href={href} verses={long && !open ? verses.slice(0, SHOWN_VERSES) : verses}
      extra={long ? <button type="button" className="scard__act" aria-expanded={open} onClick={() => { haptic("select"); setOpen(!open); }}>{open ? "Fewer verses" : `All ${verses.length} verses`}</button> : null} />
  );
}

/** A case study as a card: its title, a few lines of it, and the way in. */
export function CaseCard({ to, name, preview, meta, kind }: { to: string; name: string; preview?: string; meta?: string; kind?: CaseRow["kind"] }) {
  return (
    <Link to={to} className="ccard" data-kind={kind} onClick={() => haptic("select")}>
      {meta ? <span className="ccard__meta"><i aria-hidden="true" />{meta}</span> : null}
      <h3 className="ccard__name">{name}</h3>
      {preview ? <p className="ccard__preview">{preview}</p> : null}
      <span className="ccard__go">Open case study<Feather name="chevron-right" size={16} color="currentColor" /></span>
    </Link>
  );
}

function CaseSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <span className="skel" style={{ width: 140, height: 10 }} />
      <span className="skel" style={{ width: "60%", height: 26, marginTop: 10 }} />
      <span className="skel" style={{ width: 110, height: 22, marginTop: 12, borderRadius: 11 }} />
      <div className="case__charge" style={{ marginTop: 22 }}><span className="skel" style={{ width: "90%", height: 14 }} /><span className="skel" style={{ width: "70%", height: 14, marginTop: 8 }} /></div>
      {[0, 1, 2].map((i) => <span key={i} className="skel" style={{ width: `${92 - i * 9}%`, height: 13, marginTop: 14 }} />)}
    </div>
  );
}
