import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";

import { data, type LawSection, type ResolvedRef } from "@/api/data";
import { Feather } from "@/bible/icons";
import { useKeptScroll, useVisitState } from "@/lib/place";
import { share } from "@/lib/share";
import { useBackButton } from "@/tg/hooks";
import { haptic } from "@/tg/sdk";
import { ScriptureCard } from "@/ui/scripture";
import { Empty, List, Row, Screen, SearchField } from "@/ui/ui";
import { CaseCard } from "./Cases";

/**
 * The handbook of Bible law: its parts and their sections, and a section's laws one by one, each
 * with the scriptures it stands on (one shown at a time, the way to it in the reader), then the
 * case studies judged under it.
 */
export function LawIndex() {
  useBackButton(false);
  const { part } = useParams();
  const laws = useQuery({ queryKey: ["laws"], queryFn: data.laws, staleTime: Infinity, retry: 1 });
  const [q, setQ] = useVisitState("q", "");
  useKeptScroll(!!laws.data);
  const lc = q.trim().toLowerCase();
  const parts = useMemo(() => (laws.data ?? [])
    .filter((p) => !part || p.url.endsWith(`/${part}`))
    .map((p) => ({ ...p, sections: p.sections.filter((s) => !lc || `${s.id} ${s.title} ${p.title}`.toLowerCase().includes(lc)) }))
    .filter((p) => p.sections.length), [laws.data, part, lc]);
  const total = (laws.data ?? []).reduce((n, p) => n + p.sections.reduce((m, s) => m + s.laws, 0), 0);
  const only = part ? laws.data?.find((p) => p.url.endsWith(`/${part}`)) : undefined;

  return (
    <Screen className="laws" title={only ? only.title : "The Law"} kicker={only ? `Part ${only.n} of the handbook of Bible law` : laws.data ? `The handbook of Bible law · ${total.toLocaleString()} laws` : "The handbook of Bible law"}>
      <SearchField id="law-q" value={q} onChange={setQ} placeholder="A section or a subject: Sabbath, usury, idols" />
      {laws.isPending ? <LawListSkeleton /> : laws.isError ? (
        <Empty title="The law did not load" action={{ label: "Try again", onClick: () => void laws.refetch() }}>Check your connection.</Empty>
      ) : !parts.length ? (
        <Empty title={`No section matches “${q.trim()}”`} action={{ label: "Clear the search", onClick: () => setQ("") }}>Try another word: Sabbath, marriage, idols.</Empty>
      ) : parts.map((p) => (
        <section key={p.n} className="laws__part" aria-label={p.title}>
          <h2 className="cases__eraname"><span className="laws__n">{p.n}</span>{p.title}</h2>
          <ul className="cases__list">
            {p.sections.map((s) => (
              <li key={s.id}>
                <Link to={s.url} className="caserow lawrow2" onClick={() => haptic("select")}>
                  <span className="lawrow2__code">{s.id}</span>
                  <span className="caserow__body"><b className="caserow__name">{s.title}</b><span className="caserow__meta">{s.laws} {s.laws === 1 ? "law" : "laws"}</span></span>
                  <Feather name="chevron-right" size={18} color="currentColor" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </Screen>
  );
}

function LawListSkeleton() {
  return <div className="cases__list" aria-busy="true" aria-label="Loading">{Array.from({ length: 7 }, (_, i) => <div key={i} className="caserow caserow--wait"><span className="skel" style={{ width: 34, height: 24, borderRadius: 7 }} /><span className="caserow__body"><span className="skel" style={{ width: `${45 + ((i * 11) % 35)}%`, height: 15 }} /><span className="skel" style={{ width: 50, height: 10 }} /></span></div>)}</div>;
}

const CASES_FIRST = 4;

export function LawSectionScreen() {
  const { section = "" } = useParams();
  useBackButton(false);
  const sec = useQuery({ queryKey: ["law", section], queryFn: () => data.law(section), staleTime: Infinity, retry: 1 });
  const [casesShown, setCasesShown] = useVisitState("cases", CASES_FIRST);
  useKeptScroll(!!sec.data);
  if (sec.isPending) return <Screen className="case"><LawSkeleton /></Screen>;
  if (sec.isError || !sec.data) return (
    <Screen className="case">
      <Empty title="This section did not load" action={{ label: "Try again", onClick: () => void sec.refetch() }}>Check your connection, or <Link to="/law">open the handbook</Link>.</Empty>
    </Screen>
  );
  const s: LawSection = sec.data;
  const cases = s.caseRefs ?? [];
  const seeAlso = s.seeAlso.filter((x) => x.url);

  return (
    <Screen className="case">
      <header className="case__head">
        <div className="case__top">
          <p className="case__eyebrow"><Link to={s.part.url} className="law__part" onClick={() => haptic("select")}>Part {s.part.n} · {s.part.title}</Link></p>
          <button type="button" className="case__share" onClick={() => { haptic("select"); void share({ kind: "note", title: `${s.id} ${s.title}`, text: "The handbook of Bible law · CyberJudah", sitePath: s.url }); }}><Feather name="share-2" size={14} color="currentColor" />Share</button>
        </div>
        <h1 className="case__title"><span className="law__id">{s.id}</span>{s.title}</h1>
        <p className="law__count">{s.entries.length} {s.entries.length === 1 ? "law" : "laws"}{cases.length ? ` · ${cases.length} ${cases.length === 1 ? "case" : "cases"} judged under it` : ""}</p>
      </header>

      <div className="law__entries">
        {s.entries.map((e) => <LawEntry key={e.id} id={e.id} text={e.text} refs={e.refs} />)}
      </div>

      {cases.length ? (
        <section className="entity__section" aria-label="Cases under this law">
          <h2 className="entity__eyebrow">Cases under this law<span> · {cases.length}</span></h2>
          <div className="entity__cards">{cases.slice(0, casesShown).map((c) => <CaseCard key={c.slug} to={c.url} name={c.name} preview={c.charge} kind={c.verdict === "blessed" ? "blessing" : "judgment"} meta={c.verdict.charAt(0).toUpperCase() + c.verdict.slice(1)} />)}</div>
          {casesShown < cases.length ? <button type="button" className="entity__more" onClick={() => { haptic("select"); setCasesShown(cases.length); }}>Show all {cases.length}<span> · {cases.length - casesShown} more</span></button> : null}
        </section>
      ) : null}

      {seeAlso.length ? (
        <section className="entity__section" aria-label="See also">
          <h2 className="entity__eyebrow">See also</h2>
          <List>{seeAlso.map((x) => <Row key={x.id} href={x.url!} meta={x.id} title={x.title} />)}</List>
        </section>
      ) : null}
    </Screen>
  );
}

/** One law: its words, the scriptures it stands on as chips, the chosen one's text with the way to it. */
function LawEntry({ id, text, refs }: { id: string; text: string; refs: ResolvedRef[] }) {
  const usable = refs.filter((r) => r.slug && r.text.length);
  const [chosen, setChosen] = useState(0);
  const r = usable[Math.min(chosen, usable.length - 1)];
  return (
    <article className="lawcard" id={`law-${id}`} aria-label={`Law ${id}`}>
      <p className="lawcard__code">{id}</p>
      <p className="lawcard__text">{text}</p>
      {usable.length > 1 ? (
        <div className="lawcard__refs" role="tablist" aria-label={`Scriptures for ${id}`}>
          {usable.map((x, i) => <button key={x.label} type="button" role="tab" aria-selected={x === r} className="lawcard__ref" onClick={() => { haptic("select"); setChosen(i); }}>{x.label}</button>)}
        </div>
      ) : null}
      {r ? (
        <ScriptureCard at={{ slug: r.slug!, chapter: r.chapter, from: r.text[0].verse, to: r.text[r.text.length - 1].verse }} label={r.label}
          href={`/read/${r.slug}/${r.chapter}${r.verses ? `?v=${r.verses.replace(/\s+/g, "")}` : ""}`} verses={r.text} />
      ) : null}
    </article>
  );
}

function LawSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <span className="skel" style={{ width: 160, height: 10 }} />
      <span className="skel" style={{ width: "70%", height: 26, marginTop: 10 }} />
      {[0, 1].map((i) => <div key={i} className="lawcard" style={{ marginTop: 18 }}><span className="skel" style={{ width: 40, height: 10 }} /><span className="skel" style={{ width: "85%", height: 16, marginTop: 10 }} /><div className="scard" style={{ marginTop: 12 }}><div className="scard__text scard__text--wait"><span className="skel" /><span className="skel" /></div></div></div>)}
    </div>
  );
}
