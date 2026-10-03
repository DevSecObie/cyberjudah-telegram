import { useQueries } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";

import {
  calculateLabel, dateMarks, flatten, geometry, hasDetails, linkedEvents, rowToPx, searchEvents,
  type TimelineData, type TimelineEvent, type TimelineSection,
} from "@shared/timeline.mjs";
import raw from "@/data/timeline.json";
import { data, type ResolvedRef } from "@/api/data";
import { Feather } from "@/bible/icons";
import { newTab } from "@/lib/tabs";
import { useBackButton } from "@/tg/hooks";
import { haptic } from "@/tg/sdk";
import { useSheet } from "@/ui/sheet";
import { Empty, SearchField } from "@/ui/ui";

/**
 * Bible Strong's Bible Timeline (strong/apps/expo/src/features/timeline), ported to the web:
 * the periods (TimelineHomeScreen, TimelineItem); a period's canvas with its events placed by
 * year, the date bar, the line and the year under it, and the periods either side
 * (TimelineSection, ScrollView, TimelineEvent, Datebar, Line, CurrentYear, SectionImage); the
 * search (TimelineSearchScreen); an event (EventScreen, EventDetails).
 *
 * The years and the layout are theirs (app/src/data/timeline.json, from their events.txt);
 * their descriptions, articles, pictures and prophetic teaching are not carried. What an event
 * opens to is ours: the case studies on it, the reign Who's Who in the Bible gives a king, and
 * the verses of those case studies in the KJV.
 */
const TL = raw as TimelineData;
const SECTIONS = TL.sections;
const ALL = flatten(SECTIONS);

/** The menu at the right of a header (their ContextualMenu): Details, Open in a new tab. */
function useMenu(onDetails: () => void, path: string) {
  const sheet = useSheet();
  const navigate = useNavigate();
  return async () => {
    haptic("select");
    const a = await sheet.open({ items: [{ id: "details", text: "Details" }, { id: "tab", text: "Open in a new tab" }] });
    if (a?.id === "details") onDetails();
    if (a?.id === "tab") { newTab(path); navigate(path); }
  };
}

/** Their header: back, the title in the middle, then search and the menu. */
function Header({ title, onSearch, onMenu, color }: { title: string; onSearch?: () => void; onMenu?: () => void; color?: string }) {
  const navigate = useNavigate();
  return (
    <header className="tlh glass">
      <button type="button" className="tlh__btn" aria-label="Back" onClick={() => { haptic("select"); navigate(-1); }}><Feather name="arrow-left" size={20} color="currentColor" /></button>
      <h1 className="tlh__title" style={color ? { ["--tl-color" as string]: color } : undefined}>{title}</h1>
      <span className="tlh__actions">
        {onSearch ? <button type="button" className="tlh__btn" aria-label="Search" onClick={onSearch}><Feather name="search" size={19} color="currentColor" /></button> : null}
        {onMenu ? <button type="button" className="tlh__btn" aria-label="More" onClick={onMenu}><Feather name="more-vertical" size={18} color="currentColor" /></button> : null}
      </span>
    </header>
  );
}

/** A modal panel (their Sheet), closed from its scrim or the back button. */
function Panel({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="sheet__scrim tlp__scrim" onClick={onClose}>
      <div className="sheet tlp" role="dialog" aria-modal="true" aria-label={title} data-sheet-open="" onClick={(e) => e.stopPropagation()}>
        <div className="tlp__head"><b>{title}</b><button type="button" className="tlh__btn" aria-label="Close" onClick={onClose}><Feather name="x" size={18} color="currentColor" /></button></div>
        <div className="tlp__body">{children}</div>
      </div>
    </div>
  );
}

/** A period's emblem (their SectionImage and the card of TimelineItem, without the picture). */
function Emblem({ s, size = "card" }: { s: TimelineSection; size?: "card" | "panel" }) {
  return (
    <span className={`tl-emblem tl-emblem--${size}`} style={{ ["--tl-color" as string]: s.color }}>
      <span className="tl-emblem__age">{s.sectionTitle}</span>
      <span className="tl-emblem__title">{size === "panel" ? s.title.toUpperCase() : s.title}</span>
      <span className="tl-emblem__sub">{s.subTitle}</span>
      <i className="tl-emblem__bar" aria-hidden="true" />
    </span>
  );
}

/** Where the years and the content come from, in place of their FAQ (which teaches their reading of the dates). */
function About() {
  return (
    <div className="tl-about">
      <p>The periods, the events and their years are Bible Strong's Bible Timeline. Only its history is kept here: its descriptions, articles, pictures and prophetic interpretation are not.</p>
      <p>A king's reign, where shown, is from <i>Who's Who in the Bible</i> (Joan Comay and Ronald Brownrigg), its chronology of the kings.</p>
      <p>An event opens to our case studies on it, with their scripture in the KJV. An event with no case study yet stays on the line, greyed, as Bible Strong shows an event without details.</p>
    </div>
  );
}

/** TimelineHomeScreen: the periods, each as its card. */
export function Timeline() {
  useBackButton(false);
  const navigate = useNavigate();
  const [about, setAbout] = useState(false);
  const menu = useMenu(() => setAbout(true), "/timeline");
  return (
    <main className="tl-home">
      <Header title="The Bible Timeline" onSearch={() => navigate("/timeline/search")} onMenu={menu} />
      <ol className="tl-items">
        {SECTIONS.map((s, i) => (
          <li key={s.id}><Link to={`/timeline/${i}`} className="tl-item" onClick={() => haptic("select")}><Emblem s={s} /></Link></li>
        ))}
      </ol>
      {about ? <Panel title="Details" onClose={() => setAbout(false)}><About /></Panel> : null}
    </main>
  );
}

/**
 * TimelineSection: one period. The canvas scrolls both ways; the period before and after
 * stand at either end (SectionImage), and scrolling well into one opens it, as their pan
 * past the edge does. The date bar runs along the bottom; the line stands at 40% of the
 * screen with the year under it (CurrentYear), a bar for how far through the period, and the
 * chevrons to the periods either side.
 */
export function TimelinePeriod() {
  useBackButton(false);
  const { n = "0" } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const index = Math.min(Math.max(Number(n) || 0, 0), SECTIONS.length - 1);
  const s = SECTIONS[index];
  const prev = SECTIONS[index - 1], next = SECTIONS[index + 1];
  const box = useRef<HTMLDivElement>(null);
  const [vw, setVw] = useState(() => (typeof window === "undefined" ? 390 : Math.min(window.innerWidth, 1400)));
  const [left, setLeft] = useState(0);
  const [details, setDetails] = useState(false);
  const g = useMemo(() => geometry(s, vw), [s, vw]);
  const lead = prev ? vw : 0; // the previous period's panel before the canvas
  const menu = useMenu(() => setDetails(true), `/timeline/${index}`);

  useEffect(() => {
    const on = () => setVw(box.current?.clientWidth || Math.min(window.innerWidth, 1400));
    on(); addEventListener("resize", on);
    return () => removeEventListener("resize", on);
  }, []);
  // Entering from the next period lands at the end (their entrance 0); otherwise at the start.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.scrollLeft = params.get("from") === "next" ? lead + g.width - vw : lead;
    setLeft(el.scrollLeft - lead);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, vw]);

  const go = useCallback((to: number, from?: "next") => { haptic("select"); navigate(`/timeline/${to}${from ? "?from=next" : ""}`, { replace: true }); }, [navigate]);
  const onScroll = () => setLeft((box.current?.scrollLeft ?? 0) - lead);
  // Released well into a neighbour's panel (more than 100px, their threshold): open it.
  const onScrollEnd = () => {
    const el = box.current;
    if (!el) return;
    const x = el.scrollLeft - lead;
    if (prev && x < -100) go(index - 1, "next");
    else if (next && x > g.width - vw + 100) go(index + 1);
  };
  useEffect(() => {
    const el = box.current;
    if (!el || !("onscrollend" in el)) return;
    el.addEventListener("scrollend", onScrollEnd);
    return () => el.removeEventListener("scrollend", onScrollEnd);
  });

  const marks = dateMarks(s);
  const color = { ["--tl-color" as string]: s.color } as CSSProperties;
  return (
    <main className="tl-period" style={color}>
      <Header title={s.title} color={s.color} onSearch={() => navigate("/timeline/search")} onMenu={menu} />
      <div ref={box} className="tl-scroll" onScroll={onScroll} tabIndex={0} aria-label={`${s.title}, ${s.subTitle}: the events by year. Scroll sideways along the years.`}>
        <div className="tl-world" style={{ width: lead + g.width + (next ? vw : 0), height: g.height }}>
          {prev ? <button type="button" className="tl-panel" style={{ left: 0, width: vw }} onClick={() => go(index - 1, "next")} aria-label={`Previous period: ${prev.title}`}><Feather name="chevron-left" size={48} color="currentColor" /><Emblem s={prev} size="panel" /></button> : null}
          <div className="tl-canvas" style={{ left: lead, width: g.width, height: g.height }}>
            {s.events.map((e) => <Bar key={`${e.id}-${e.slug}`} e={e} g={g} />)}
            <div className="tl-datebar" style={{ width: g.width, paddingLeft: g.offset }} aria-hidden="true">
              {marks.map((year, i) => <span key={year} style={{ left: g.offset + i * 100 }}>{year < 2020 ? Math.abs(year) : "Future"}</span>)}
            </div>
          </div>
          {next ? <button type="button" className="tl-panel" style={{ left: lead + g.width, width: vw }} onClick={() => go(index + 1)} aria-label={`Next period: ${next.title}`}><Emblem s={next} size="panel" /><Feather name="chevron-right" size={48} color="currentColor" /></button> : null}
        </div>
      </div>
      <i className="tl-line" style={{ left: g.offset }} aria-hidden="true" />
      <div className="tl-current">
        {prev ? <button type="button" className="tl-current__nav" style={{ left: 0, color: prev.color }} aria-label={`Previous period: ${prev.title}`} onClick={() => go(index - 1, "next")}><Feather name="chevrons-left" size={20} color="currentColor" /></button> : null}
        <output className="tl-current__year" style={{ left: g.offset - 50 }} aria-live="polite">{g.yearAt(Math.max(0, left))}</output>
        {next ? <button type="button" className="tl-current__nav tl-current__nav--next" style={{ color: next.color }} aria-label={`Next period: ${next.title}`} onClick={() => go(index + 1)}><Feather name="chevrons-right" size={20} color="currentColor" /></button> : null}
        <i className="tl-current__progress" style={{ width: `${g.progress(Math.max(0, left))}%` }} aria-hidden="true" />
      </div>
      {details ? <Panel title={s.sectionTitle} onClose={() => setDetails(false)}><PeriodDetails s={s} /></Panel> : null}
    </main>
  );
}

/** SectionDetailsModal: the period's emblem; in place of their description, the case studies on its events. */
function PeriodDetails({ s }: { s: TimelineSection }) {
  const withCases = s.events.filter((e) => e.cases?.length);
  return (
    <div className="tl-details">
      <Emblem s={s} size="panel" />
      {withCases.length ? (
        <>
          <h2 className="entity__eyebrow">Case studies in this period<span> · {withCases.reduce((n, e) => n + e.cases!.length, 0)}</span></h2>
          <ul className="tl-details__list">{withCases.map((e) => <li key={e.slug}><Link to={`/timeline/event/${e.slug}`} onClick={() => haptic("select")}><b>{e.title}</b><span>{calculateLabel(e.start, e.end)}</span></Link></li>)}</ul>
        </>
      ) : <p className="hint">No case study is on an event of this period yet.</p>}
    </div>
  );
}

/**
 * TimelineEvent: a bar from its start year, on its row. A major event is 60px tall with its
 * title and date, which ride along the bar as it scrolls by; a minor one is a 25px pill. An
 * event with nothing to open is dimmed and does not open, as theirs without details.
 */
function Bar({ e, g }: { e: TimelineEvent; g: ReturnType<typeof geometry> }) {
  const open = hasDetails(e);
  const label = calculateLabel(e.start, e.end);
  const style: CSSProperties = { top: rowToPx(e.row), left: g.yearsToPx(e.start) + g.offset };
  const inner = e.type === "minor"
    ? <><span className="tl-minor__title">{e.title}</span><span className="tl-minor__date">{label}</span></>
    : <span className="tl-major__desc"><span className="tl-major__title">{e.title}</span><i aria-hidden="true" /><span className="tl-major__date">{label}</span></span>;
  const cls = e.type === "minor" ? "tl-minor" : "tl-major";
  if (e.type !== "minor") style.width = g.eventWidth(e.start, e.end, e.isFixed);
  return open
    ? <Link to={`/timeline/event/${e.slug}`} className={cls} style={style} data-cases={e.cases?.length || undefined} onClick={() => haptic("select")}>{inner}</Link>
    : <span className={cls} style={style} data-off="">{inner}</span>;
}

/** TimelineSearchScreen: events by their title or date, those that open. */
export function TimelineSearch() {
  useBackButton(false);
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  useEffect(() => { const t = setTimeout(() => setTerm(q), 250); return () => clearTimeout(t); }, [q]);
  const results = useMemo(() => searchEvents(SECTIONS, term), [term]);
  return (
    <main className="tl-search">
      <Header title="Search" />
      <div className="tl-search__field"><SearchField id="tl-search" value={q} onChange={setQ} placeholder="Search for an event in the Bible" autoFocus /></div>
      {results.length ? (
        <>
          <p className="tl-search__count">{results.length} {results.length === 1 ? "event" : "events"} found</p>
          <ul className="tl-search__list">
            {results.map((e) => (
              <li key={e.slug}><Link to={`/timeline/event/${e.slug}`} onClick={() => haptic("select")}>
                <b>{e.title} ({calculateLabel(e.start, e.end)})</b>
                <span>{[e.reign ? `Reign ${reignLabel(e.reign)}` : "", (e.cases ?? []).map((c) => c.name).join(" · ")].filter(Boolean).join(" · ")}</span>
              </Link></li>
            ))}
          </ul>
        </>
      ) : term.trim() ? <Empty title="No results">Try another name or a year.</Empty> : <Empty title="Search the Bible Timeline">A person, a king, an event, or a year such as 853.</Empty>}
    </main>
  );
}

const reignLabel = (r: NonNullable<TimelineEvent["reign"]>) => `${r.approx ? "c. " : ""}${r.from === r.to ? r.from : `${r.from}–${r.to}`} BC, ${r.kingdom === "United" ? "the united kingdom" : r.kingdom}`;

/**
 * EventScreen and EventDetails: the title and date; in place of their description, the
 * reign from Who's Who and our case studies; the verses of those case studies (the first
 * three of each passage, as theirs, opening the Bible at it); and the events linked to it.
 */
export function TimelineEventScreen() {
  useBackButton(false);
  const { slug = "" } = useParams();
  const [about, setAbout] = useState(false);
  const menu = useMenu(() => setAbout(true), `/timeline/event/${slug}`);
  const e = ALL.find((x) => x.slug === slug);
  const cases = useQueries({ queries: (e?.cases ?? []).map((c) => ({ queryKey: ["case", c.slug], queryFn: () => data.case(c.slug), staleTime: Infinity, retry: 1 })) });
  if (!e) return (
    <main className="tl-event"><Header title="Bible timeline" /><Empty title="This event is no longer available.">Go back to <Link to="/timeline">the timeline</Link>.</Empty></main>
  );
  const s = SECTIONS[e.sectionIndex];
  const refs: ResolvedRef[] = cases.flatMap((q) => (q.data?.refsResolved ?? []).filter((r) => r.slug && r.text.length));
  const seen = new Set<string>();
  const verses = refs.filter((r) => (seen.has(r.label) ? false : (seen.add(r.label), true)));
  const linked = linkedEvents(SECTIONS, e.slug);
  const loading = cases.some((q) => q.isPending);
  return (
    <main className="tl-event" style={{ ["--tl-color" as string]: s.color }}>
      <Header title={e.title} onMenu={menu} />
      <div className="tl-event__body">
        <div className="tl-event__head">
          <p className="tl-event__title">{e.title}</p>
          <p className="tl-event__date">{calculateLabel(e.start, e.end)}</p>
          <Link className="tl-event__period" to={`/timeline/${e.sectionIndex}`}>{s.title} · {s.subTitle}</Link>
        </div>

        {e.reign ? (
          <section className="tl-event__section" aria-label="Reign">
            <h2>Reign</h2>
            <p>{reignLabel(e.reign)} <span className="tl-event__src">Who's Who in the Bible</span></p>
          </section>
        ) : null}

        {e.cases?.length ? (
          <section className="tl-event__section" aria-label="Case studies">
            <h2>Case studies</h2>
            <ul className="tl-event__cases">
              {e.cases.map((c, i) => {
                const k = cases[i]?.data;
                return (
                  <li key={c.slug}><Link to={k?.url ?? `/cases`} className="tl-related" data-kind={c.kind} onClick={() => haptic("select")}>
                    <span><b>{c.name}</b>{k?.charge ? <small>{k.charge}</small> : null}</span>
                    <Feather name="chevron-right" size={22} color="currentColor" />
                  </Link></li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {verses.length ? (
          <section className="tl-event__section" aria-label="Verses">
            <h2>Verses</h2>
            {verses.map((r) => (
              <Link key={r.label} className="tl-verse" to={`/read/${r.slug}/${r.chapter}${r.verses ? `?v=${r.verses.replace(/\s+/g, "")}` : ""}`} onClick={() => haptic("select")}>
                <span className="tl-verse__ref">{r.label}</span>
                <span className="tl-verse__text">{r.text.slice(0, 3).map((v) => <span key={v.verse}><sup>{v.verse}</sup> {v.text} </span>)}{r.text.length > 3 ? "…" : null}</span>
              </Link>
            ))}
          </section>
        ) : loading && e.cases?.length ? <p className="hint" aria-busy="true">Loading the verses…</p> : null}

        {linked.length ? (
          <section className="tl-event__section" aria-label="Linked events">
            <h2>Linked events</h2>
            {linked.map((l) => <Link key={l.slug} to={`/timeline/event/${l.slug}`} className="tl-related" onClick={() => haptic("select")}><span><b>{l.title}</b><small>{calculateLabel(l.start, l.end)}</small></span><Feather name="chevron-right" size={22} color="currentColor" /></Link>)}
          </section>
        ) : null}
      </div>
      {about ? <Panel title="Details" onClose={() => setAbout(false)}><About /></Panel> : null}
    </main>
  );
}
