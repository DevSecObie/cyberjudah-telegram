import { useQuery } from "@tanstack/react-query";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router";

import { data, type LawSection, type ResolvedRef } from "@/api/data";
import { Feather } from "@/bible/icons";
import { useKeptScroll, useVisitState } from "@/lib/place";
import { share } from "@/lib/share";
import { useBackButton } from "@/tg/hooks";
import { haptic } from "@/tg/sdk";
import { useSheet } from "@/ui/sheet";
import { Empty, Icon, Screen, SearchField } from "@/ui/ui";
import { CaseCard } from "./Cases";

const LAW_HITS = 30;

/**
 * The handbook of Bible law: its parts and their sections, searchable by a section's name or by
 * the words of any law in it, with a part picked to narrow it. A section opens its laws one by one.
 */
export function LawIndex() {
  useBackButton(false);
  const { part } = useParams();
  const sheet = useSheet();
  const laws = useQuery({ queryKey: ["laws"], queryFn: data.laws, staleTime: Infinity, retry: 1 });
  const [q, setQ] = useVisitState("q", "");
  const [pick, setPick] = useVisitState("part", 0);
  const query = useDeferredValue(q.trim().toLowerCase());
  // The laws' own words load only once someone searches.
  const texts = useQuery({ queryKey: ["law-texts"], queryFn: data.lawTexts, staleTime: Infinity, retry: 1, enabled: query.length > 1 });
  useKeptScroll(!!laws.data);
  const only = part ? laws.data?.find((p) => p.url.endsWith(`/${part}`)) : undefined;
  const partN = only?.n ?? pick;
  const parts = useMemo(() => (laws.data ?? [])
    .filter((p) => !partN || p.n === partN)
    .map((p) => ({ ...p, sections: p.sections.filter((s) => !query || `${s.id} ${s.title} ${p.title}`.toLowerCase().includes(query)) }))
    .filter((p) => p.sections.length), [laws.data, partN, query]);
  const sectionOf = useMemo(() => new Map((laws.data ?? []).flatMap((p) => p.sections.map((s) => [s.id, { title: s.title, part: p.n }] as const))), [laws.data]);
  const hits = useMemo(() => query.length > 1 ? (texts.data ?? []).filter((l) => l.text.toLowerCase().includes(query) && (!partN || sectionOf.get(l.id.split(".")[0])?.part === partN)) : [], [texts.data, query, partN, sectionOf]);
  const total = (laws.data ?? []).reduce((n, p) => n + p.sections.reduce((m, s) => m + s.laws, 0), 0);
  const chosen = laws.data?.find((p) => p.n === partN);
  const choosePart = async () => {
    haptic("select");
    const a = await sheet.open({ title: "Part of the handbook", items: [{ id: "0", text: "Every part", hint: partN ? undefined : "Selected" }, ...(laws.data ?? []).map((p) => ({ id: String(p.n), text: `${p.n}. ${p.title}`, hint: p.n === partN ? "Selected" : `${p.sections.length} ${p.sections.length === 1 ? "section" : "sections"}` }))] });
    if (a) setPick(+a.id);
  };
  const reset = () => { setQ(""); setPick(0); };
  const filtered = !!(q.trim() || (!part && pick));

  return (
    <Screen className="laws" title={only ? only.title : "The Law"} kicker={only ? `Part ${only.n} of the handbook of Bible law` : laws.data ? `The handbook of Bible law · ${total.toLocaleString()} laws` : "The handbook of Bible law"}>
      <div className="laws__tools">
        <SearchField id="law-q" value={q} onChange={setQ} placeholder="Search the law: Sabbath, usury, idols" />
        {!part ? (
          <div className="cfeed__filters">
            <button type="button" className="cfeed__pick" data-on={pick ? "" : undefined} disabled={!laws.data} aria-label={`Part: ${chosen ? chosen.title : "every part"}`} title={`Part: ${chosen ? chosen.title : "every part"}`} onClick={() => void choosePart()}><span>{chosen ? `${chosen.n}. ${chosen.title}` : "Every part"}</span><Icon name="chevron" size={14} /></button>
            {filtered ? <button type="button" className="cfeed__reset" onClick={() => { haptic("select"); reset(); }}>Reset</button> : null}
          </div>
        ) : null}
      </div>
      {laws.isPending ? <LawListSkeleton /> : laws.isError ? (
        <Empty title="The law did not load" action={{ label: "Try again", onClick: () => void laws.refetch() }}>Check your connection.</Empty>
      ) : (
        <>
          {query.length > 1 ? (
            <section className="laws__hits" aria-label="Laws that say this">
              <h2 className="laws__head">Laws that say “{q.trim()}”{texts.data ? <span> · {hits.length}</span> : null}</h2>
              {texts.isPending ? <div className="laws__wait" aria-busy="true" aria-label="Searching the laws"><span className="skel" /><span className="skel" /></div>
                : texts.isError ? <p className="laws__note">The laws’ words did not load. <button type="button" className="link" onClick={() => void texts.refetch()}>Try again</button></p>
                : !hits.length ? <p className="laws__note">No law uses those words{partN ? " in this part" : ""}.</p>
                : (
                  <ul className="laws__list">
                    {hits.slice(0, LAW_HITS).map((l) => (
                      <li key={l.id}>
                        <Link to={l.url} className="lawlink" onClick={() => haptic("select")}>
                          <span className="lawlink__code">{l.id}</span>
                          <span className="lawlink__body"><span className="lawlink__law">{l.text}</span><small>{sectionOf.get(l.id.split(".")[0])?.title}</small></span>
                          <Feather name="chevron-right" size={18} color="currentColor" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              {hits.length > LAW_HITS ? <p className="laws__note">Showing the first {LAW_HITS} of {hits.length}. Add a word to narrow it.</p> : null}
            </section>
          ) : null}
          {!parts.length ? (
            query.length > 1 && hits.length ? null : <Empty title={`No section matches “${q.trim()}”`} action={{ label: "Reset the search", onClick: reset }}>Try another word: Sabbath, marriage, idols.</Empty>
          ) : (
            <>
              {query.length > 1 ? <h2 className="laws__head">Sections</h2> : null}
              {parts.map((p) => (
                <section key={p.n} className="laws__part" aria-label={p.title}>
                  <h2 className="laws__parthead"><span className="laws__n">{p.n}</span><span>{p.title}</span></h2>
                  <ul className="laws__list">
                    {p.sections.map((s) => (
                      <li key={s.id}>
                        <Link to={s.url} className="lawlink" onClick={() => haptic("select")}>
                          <span className="lawlink__code">{s.id}</span>
                          <span className="lawlink__body"><b>{s.title}</b><small>{s.laws} {s.laws === 1 ? "law" : "laws"}</small></span>
                          <Feather name="chevron-right" size={18} color="currentColor" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </>
          )}
        </>
      )}
    </Screen>
  );
}

function LawListSkeleton() {
  return <ul className="laws__list" aria-busy="true" aria-label="Loading">{Array.from({ length: 7 }, (_, i) => <li key={i}><div className="lawlink"><span className="skel" style={{ width: 34, height: 22, borderRadius: 7 }} /><span className="lawlink__body"><span className="skel" style={{ width: `${45 + ((i * 11) % 35)}%`, height: 15 }} /><span className="skel" style={{ width: 50, height: 10, marginTop: 6 }} /></span></div></li>)}</ul>;
}

const CASES_FIRST = 4;

/** A section of the law: its laws in the handbook's order, each with the scriptures it stands on. */
export function LawSectionScreen() {
  const { section = "" } = useParams();
  const location = useLocation();
  useBackButton(false);
  const sec = useQuery({ queryKey: ["law", section], queryFn: () => data.law(section), staleTime: Infinity, retry: 1 });
  const [casesShown, setCasesShown] = useVisitState("cases", CASES_FIRST);
  useKeptScroll(!!sec.data);
  // A law reached from a search ("#2H.4") is brought into view and marked, once per visit.
  const [flash, setFlash] = useState("");
  const went = useRef("");
  useEffect(() => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (!sec.data || !id || went.current === location.key || window.scrollY > 4) return;
    went.current = location.key;
    const el = document.getElementById(`law-${id}`);
    if (!el) return;
    requestAnimationFrame(() => el.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }));
    setFlash(id);
  }, [sec.data, location.hash, location.key]);
  if (sec.isPending) return <Screen className="lawsec"><LawSkeleton /></Screen>;
  if (sec.isError || !sec.data) return (
    <Screen className="lawsec">
      <Empty title="This section did not load" action={{ label: "Try again", onClick: () => void sec.refetch() }}>Check your connection, or <Link to="/law">open the handbook</Link>.</Empty>
    </Screen>
  );
  const s: LawSection = sec.data;
  const cases = s.caseRefs ?? [];
  const seeAlso = s.seeAlso.filter((x) => x.url);

  return (
    <Screen className="lawsec">
      <header className="lawsec__head">
        <div className="lawsec__top">
          <Link to={s.part.url} className="lawsec__part" onClick={() => haptic("select")}>Part {s.part.n} · {s.part.title}</Link>
          <button type="button" className="lawsec__share" onClick={() => { haptic("select"); void share({ kind: "note", title: `${s.id} ${s.title}`, text: "The handbook of Bible law · CyberJudah", sitePath: s.url }); }}><Feather name="share-2" size={15} color="currentColor" />Share</button>
        </div>
        <h1 className="lawsec__title"><span className="lawsec__id">{s.id}</span> {s.title}</h1>
        <p className="lawsec__count">{s.entries.length} {s.entries.length === 1 ? "law" : "laws"}{cases.length ? ` · ${cases.length} ${cases.length === 1 ? "case" : "cases"} judged under it` : ""}</p>
      </header>

      <ol className="lawsec__laws">
        {s.entries.map((e) => <li key={e.id}><LawCard id={e.id} text={e.text} refs={e.refs} flash={flash === e.id} /></li>)}
      </ol>

      {cases.length ? (
        <section className="entity__section" aria-label="Cases under this law">
          <h2 className="entity__eyebrow">Cases under this law<span> · {cases.length}</span></h2>
          <div className="entity__cards">{cases.slice(0, casesShown).map((c) => <CaseCard key={c.slug} to={c.url} name={c.name} preview={c.charge} kind={c.verdict === "blessed" ? "blessing" : "judgment"} meta={c.verdict.charAt(0).toUpperCase() + c.verdict.slice(1)} />)}</div>
          {casesShown < cases.length ? <button type="button" className="entity__more" onClick={() => { haptic("select"); setCasesShown(cases.length); }}>Show all {cases.length}<span> · {cases.length - casesShown} more</span></button> : null}
        </section>
      ) : null}

      {seeAlso.length ? (
        <section className="entity__section" aria-label="Related laws">
          <h2 className="entity__eyebrow">Related laws</h2>
          <ul className="laws__list">
            {seeAlso.map((x) => (
              <li key={x.id}><Link to={x.url!} className="lawlink" onClick={() => haptic("select")}><span className="lawlink__code">{x.id}</span><span className="lawlink__body"><b>{x.title}</b></span><Feather name="chevron-right" size={18} color="currentColor" /></Link></li>
            ))}
          </ul>
        </section>
      ) : null}
    </Screen>
  );
}

const REFS_FIRST = 3;
const VERSES_FIRST = 4;

/**
 * One law: its words, the scriptures it stands on (one shown at a time), the King James text of
 * the one chosen set apart as a quotation, and the way to it in the reader.
 */
function LawCard({ id, text, refs, flash }: { id: string; text: string; refs: ResolvedRef[]; flash: boolean }) {
  const usable = refs.filter((r) => r.slug && r.text.length);
  const [chosen, setChosen] = useState(0);
  const [allRefs, setAllRefs] = useState(false);
  const [allVerses, setAllVerses] = useState(false);
  const r = usable[Math.min(chosen, usable.length - 1)];
  const tabs = allRefs || usable.length <= REFS_FIRST + 1 ? usable : usable.slice(0, REFS_FIRST);
  const verses = r ? (allVerses ? r.text : r.text.slice(0, VERSES_FIRST)) : [];
  const many = (r?.text.length ?? 0) > 1;
  const href = r ? `/read/${r.slug}/${r.chapter}${r.verses ? `?v=${r.verses.replace(/\s+/g, "")}` : ""}` : "";
  return (
    <article className="lawcard" id={`law-${id}`} aria-label={`Law ${id}`} data-flash={flash ? "" : undefined}>
      <p className="lawcard__code">{id}</p>
      <h2 className="lawcard__text">{text}</h2>
      {usable.length > 1 ? (
        <div className="lawcard__refs" role="tablist" aria-label={`Scriptures for ${id}`}>
          {tabs.map((x, i) => <button key={x.label} type="button" role="tab" aria-selected={x === r} className="lawcard__ref" onClick={() => { haptic("select"); setChosen(i); setAllVerses(false); }}>{x.label}</button>)}
          {usable.length > tabs.length ? <button type="button" className="lawcard__ref lawcard__ref--more" onClick={() => setAllRefs(true)}>+{usable.length - tabs.length} more</button> : null}
        </div>
      ) : null}
      {r ? (
        <figure className="lawcard__quote" role={usable.length > 1 ? "tabpanel" : undefined} aria-label={r.label}>
          <figcaption className="lawcard__cite">{r.label}<span>KJV</span></figcaption>
          <blockquote>{verses.map((v) => <span key={v.verse}>{many ? <sup>{v.verse}</sup> : null}{v.text} </span>)}</blockquote>
          <div className="lawcard__foot">
            {r.text.length > VERSES_FIRST && !allVerses ? <button type="button" className="lawcard__all" onClick={() => setAllVerses(true)}>All {r.text.length} verses</button> : <span />}
            <Link to={href} className="lawcard__go" aria-label={`Go to verse: ${r.label}`} onClick={() => haptic("select")}>Go to verse<Feather name="chevron-right" size={16} color="currentColor" /></Link>
          </div>
        </figure>
      ) : <p className="lawcard__noref">{refs.map((x) => x.label).join("; ") || "No scripture is given for this law."}</p>}
    </article>
  );
}

function LawSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <span className="skel" style={{ width: 160, height: 10 }} />
      <span className="skel" style={{ width: "70%", height: 26, marginTop: 10 }} />
      {[0, 1].map((i) => <div key={i} className="lawcard" style={{ marginTop: 18 }}><span className="skel" style={{ width: 40, height: 10 }} /><span className="skel" style={{ width: "85%", height: 18, marginTop: 10 }} /><span className="skel" style={{ width: "95%", height: 13, marginTop: 14 }} /><span className="skel" style={{ width: "80%", height: 13, marginTop: 6 }} /></div>)}
    </div>
  );
}
