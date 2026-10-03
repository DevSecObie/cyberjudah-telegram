import { useQueries } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useNavigationType, useParams, useSearchParams } from "react-router";

import {
  calculateLabel, dateMarks, flatten, geometry, hasDetails, linkedEvents, rowToPx, searchEvents,
  type TimelineData, type TimelineEvent, type TimelineSection,
} from "@shared/timeline.mjs";
import raw from "@/data/timeline.json";
import { data, type ResolvedRef } from "@/api/data";
import { Feather } from "@/bible/icons";
import { newTab } from "@/lib/tabs";
import { useKeptScroll } from "@/lib/place";
import { useBackButton, useStored } from "@/tg/hooks";
import { haptic, hideKeyboard } from "@/tg/sdk";
import { Lit } from "@/ui/search-hero";
import { SearchBar, useSettled } from "@/ui/search-bar";
import { useSheet } from "@/ui/sheet";
import { Empty, Icon } from "@/ui/ui";
import { FinalCaptivityDetail } from "./TimelineFinalCaptivity";
import { BackgroundExtension } from "@/ui/BackgroundExtension";
import { PhotoEdit, usePhotos } from "@/ui/photo-edit";

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
 * the verses of those case studies in the KJV. The pictures are ours too: each period's from
 * Higgsfield under the assembly's depiction brief, and an event's the approved People portrait
 * of the person it is about (docs/TIMELINE_PARITY.md lists them, and the periods still waiting).
 * docs/TIMELINE_PARITY.md is the checklist of their behaviour, item by item.
 */
const TL = raw as TimelineData;
const SECTIONS = TL.sections;
const ALL = flatten(SECTIONS);
/** The Final Captivity, the last age (app/scripts/final-captivity): its name and the date its sources were reviewed through. */
const FINAL_CAPTIVITY = TL.finalCaptivity;
const reviewed = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString([], { year: "numeric", month: "long", day: "numeric" });
const BASE = import.meta.env.BASE_URL;

/**
 * Periods with an approved picture (app/public/timeline/periods/<id>.webp, 640x800, their 4:5).
 * The others wait on a depiction the assembly has not settled (docs/TIMELINE_PARITY.md) and show
 * the period's colour in its place.
 */
const PERIOD_PICTURES = new Set(["1", "2", "4", "5", "6", "7", "8", "9", "10", "11", "12"]);

/** An admin's cover or the existing approved period artwork; no image for unapproved periods. */
function usePeriodPicture(s: TimelineSection) {
  const set = usePhotos().data?.[`period:${s.id}`];
  return set ?? (PERIOD_PICTURES.has(s.id) ? `${BASE}timeline/periods/${s.id}.webp` : undefined);
}

/** A period's picture, or its colour where the picture waits on direction. Decorative: the title is beside it. */
function PeriodPicture({ s, className, eager }: { s: TimelineSection; className: string; eager?: boolean }) {
  const src = usePeriodPicture(s);
  return src
    ? <img className={className} src={src} alt="" width={640} height={800} loading={eager ? "eager" : "lazy"} decoding="async" draggable={false} />
    : <span className={`${className} tl-pic--none`} style={{ ["--tl-color" as string]: s.color }} aria-hidden="true" />;
}

/** An event's picture: the approved portrait of its person, at the size drawn (64px strip, 150px detail, search). */
/** An event's picture: the approved People portrait of its person, or the portrait of the IUIC leader it is about (app/scripts/final-captivity/leaders.json). */
const portraitSrc = (e: TimelineEvent, size: 128 | 256, photos?: Record<string, string>) =>
  // A photo an admin set in the app comes first (ui/photo-edit.tsx): the event's own, then its leader's.
  photos?.[`event:${e.slug}`] ?? (e.leader ? photos?.[`leader:${e.leader}`] : undefined)
  ?? (e.portrait ? `${BASE}people/${e.portrait}-${size}.webp` : e.leader ? `${BASE}timeline/leaders/${e.leader}-${size}.webp` : null);

/** Where a period's canvas was, and which event was opened from it, for this visit (the history entry). */
type Place = { x: number; y: number; focus?: string };
const placeKey = (key: string) => `visit:${key}:timeline`;
const readPlace = (key: string): Place | undefined => { try { const v = sessionStorage.getItem(placeKey(key)); return v ? JSON.parse(v) as Place : undefined; } catch { return undefined; } };
const writePlace = (key: string, p: Place) => { try { sessionStorage.setItem(placeKey(key), JSON.stringify(p)); } catch { /* private mode */ } };
const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

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

/** A period's emblem: the card of TimelineItem, and the words of SectionImage. */
function Emblem({ s }: { s: TimelineSection }) {
  return (
    <span className="tl-emblem tl-emblem--card" style={{ ["--tl-color" as string]: s.color }}>
      <span className="tl-emblem__age">{s.sectionTitle}{String(s.id).startsWith("fc-") ? <b className="tl-emblem__new">New</b> : null}</span>
      <span className="tl-emblem__title">{s.title}</span>
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
      <p>The pictures are ours, painted for CyberJudah under the assembly's depiction brief: each period's scene, and on an event the approved portrait of the person it is about. A period still waiting on direction shows its colour.</p>
      <p>A king's reign, where shown, is from <i>Who's Who in the Bible</i> (Joan Comay and Ronald Brownrigg), its chronology of the kings.</p>
      <p>An event opens to our case studies on it, with their scripture in the KJV. An event with no case study yet stays on the line, greyed, as Bible Strong shows an event without details.</p>
      {FINAL_CAPTIVITY ? <>
        <h3 className="tl-about__h">{FINAL_CAPTIVITY.age}</h3>
        <p>The last age is ours: the captivity, displacement, persecution, resistance and achievements of the peoples the assembly identifies as the Israelites today, and the founding and growth of Israel United in Christ.</p>
        <p>Each event keeps three things apart: the documented history, from the sources listed under it; quotes and sources from the classes, each linked to the class or episode at the moment it was said; and the Scriptures read with it. Where sources disagree, both are shown.</p>
        <p>This age is still being written. Events are added as each one is checked against the classes and the sources, through today. Sources reviewed through {reviewed(FINAL_CAPTIVITY.reviewedThrough)}.</p>
      </> : null}
    </div>
  );
}

/**
 * SectionImage: a period's title card, as it stands while the period opens and either side of
 * the canvas: the age, the TITLE, the dates between rules, the square picture, the colour bar.
 */
function SectionCard({ s, direction }: { s: TimelineSection; direction?: "previous" | "next" }) {
  return (
    <span className="tl-card" style={{ ["--tl-color" as string]: s.color }}>
      <span className="tl-card__side" aria-hidden="true">{direction === "previous" ? <Feather name="chevron-left" size={60} color="currentColor" /> : null}</span>
      <span className="tl-card__main">
        <span className="tl-card__age">{s.sectionTitle}</span>
        <span className="tl-card__title">{s.title.toUpperCase()}</span>
        <span className="tl-card__sub">{s.subTitle}</span>
        <PeriodPicture s={s} className="tl-card__pic" />
        <i className="tl-card__bar" aria-hidden="true" />
      </span>
      <span className="tl-card__side" aria-hidden="true">{direction === "next" ? <Feather name="chevron-right" size={60} color="currentColor" /> : null}</span>
    </span>
  );
}

/** TimelineHomeScreen: the periods, each as its card (TimelineItem) over its picture. */
export function Timeline() {
  useBackButton(false);
  const navigate = useNavigate();
  const [about, setAbout] = useState(false);
  const menu = useMenu(() => setAbout(true), "/timeline");
  useKeptScroll(true);
  return (
    <main className="tl-home">
      <Header title="The Bible Timeline" onSearch={() => navigate("/timeline/search")} onMenu={menu} />
      <ol className="tl-items">
        {SECTIONS.map((s, i) => (
          <li key={s.id}><Link to={`/timeline/${i}`} className="tl-item" onClick={() => haptic("select")}><Emblem s={s} /><PeriodPicture s={s} className="tl-item__pic" eager={i < 2} /></Link></li>
        ))}
      </ol>
      {about ? <Panel title="Details" onClose={() => setAbout(false)}><About /></Panel> : null}
    </main>
  );
}

/**
 * TimelineSection: one period. The canvas scrolls both ways; past either end the canvas draws
 * away and the neighbouring period's title card fades in behind it (Prev/NextSectionImage), and
 * letting go more than 100px into it opens that period, as their pan past the edge does. The line
 * and the year under it travel with the canvas past the ends (their lineX). The date bar runs
 * along the bottom; the line stands at 40% of the screen with the year under it (CurrentYear), a
 * bar for how far through the period, and the chevrons to the periods either side.
 *
 * Opening a period shows its title card, then the canvas slides in from the side it was entered
 * from (ScrollView's entrance: 1.5s, then 1s; at once with reduced motion). Coming back to it
 * (from an event, a verse, a case study) puts the canvas where it was, with the event that was
 * opened focused, and skips the entrance, as their stack keeps the period under the event.
 */
export function TimelinePeriod() {
  useBackButton(false);
  const { n = "0" } = useParams();
  const [params] = useSearchParams();
  const { key } = useLocation();
  const navigate = useNavigate();
  const index = Math.min(Math.max(Number(n) || 0, 0), SECTIONS.length - 1);
  const s = SECTIONS[index];
  const picture = usePeriodPicture(s);
  const prev = SECTIONS[index - 1], next = SECTIONS[index + 1];
  const box = useRef<HTMLDivElement>(null);
  const [vw, setVw] = useState(() => (typeof window === "undefined" ? 390 : Math.min(window.innerWidth, 1400)));
  const [left, setLeft] = useState(0);
  const [details, setDetails] = useState(false);
  const g = useMemo(() => geometry(s, vw), [s, vw]);
  const lead = prev ? vw : 0; // the previous period's panel before the canvas
  const end = g.width - vw; // the last scroll position inside the canvas
  const menu = useMenu(() => setDetails(true), `/timeline/${index}`);
  const fromNext = params.get("from") === "next";
  // A visit already made (coming back to it) is put back; a new one enters.
  const [kept] = useState(() => readPlace(key));
  const [phase, setPhase] = useState<"card" | "slide" | "ready">(() => (kept || reducedMotion() ? "ready" : "card"));

  useEffect(() => {
    const on = () => setVw(box.current?.clientWidth || Math.min(window.innerWidth, 1400));
    on(); addEventListener("resize", on);
    return () => removeEventListener("resize", on);
  }, []);
  // Where the canvas starts: where it was on this visit; else, entering from the next period, at
  // the end (their entrance 0); otherwise at the start.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    if (kept) { el.scrollLeft = kept.x; el.scrollTop = kept.y; }
    else el.scrollLeft = fromNext ? lead + end : lead;
    setLeft(el.scrollLeft - lead);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, vw]);
  // The event opened from here has the focus again (their selection is the event pushed over the period).
  useEffect(() => {
    if (!kept?.focus) return;
    box.current?.querySelector<HTMLElement>(`[data-slug="${CSS.escape(kept.focus)}"]`)?.focus({ preventScroll: true });
  }, [kept]);
  // The entrance: the title card, then the canvas slides in.
  useEffect(() => {
    if (phase === "ready") return;
    const t = window.setTimeout(() => setPhase(phase === "card" ? "slide" : "ready"), phase === "card" ? 1500 : 1000);
    return () => window.clearTimeout(t);
  }, [phase]);

  const go = useCallback((to: number, from?: "next") => { haptic("select"); navigate(`/timeline/${to}${from ? "?from=next" : ""}`, { replace: true }); }, [navigate]);
  const save = useRef(0);
  const onScroll = () => {
    const el = box.current;
    if (!el) return;
    setLeft(el.scrollLeft - lead);
    cancelAnimationFrame(save.current);
    save.current = requestAnimationFrame(() => writePlace(key, { ...readPlace(key), x: Math.round(el.scrollLeft), y: Math.round(el.scrollTop) }));
  };
  // Released well into a neighbour's panel (more than 100px, their threshold): open it.
  const onScrollEnd = () => {
    const el = box.current;
    if (!el) return;
    const x = el.scrollLeft - lead;
    if (prev && x < -100) go(index - 1, "next");
    else if (next && x > end + 100) go(index + 1);
  };
  useEffect(() => {
    const el = box.current;
    if (!el || !("onscrollend" in el)) return;
    el.addEventListener("scrollend", onScrollEnd);
    return () => el.removeEventListener("scrollend", onScrollEnd);
  });
  /** Opening an event: remember the place and the event, so coming back finds both. */
  const opened = (slug: string) => {
    const el = box.current;
    writePlace(key, { x: Math.round(el?.scrollLeft ?? 0), y: Math.round(el?.scrollTop ?? 0), focus: slug });
  };

  const marks = dateMarks(s);
  // Past either end, the line and the year go with the canvas, and the neighbour's card shows through.
  const past = left < 0 ? -left : left > end ? end - left : 0;
  const prevShown = prev ? Math.min(1, Math.max(0, -left / vw)) : 0;
  const nextShown = next ? Math.min(1, Math.max(0, (left - end) / vw)) : 0;
  const color = { ["--tl-color" as string]: s.color } as CSSProperties;
  return (
    <main className="tl-period" style={color} data-phase={phase}>
      <BackgroundExtension src={picture} />
      <Header title={s.title} color={s.color} onSearch={() => navigate("/timeline/search")} onMenu={menu} />
      <div className="tl-stage">
        {prev ? <div className="tl-behind" style={{ opacity: prevShown }} aria-hidden="true"><SectionCard s={prev} direction="previous" /></div> : null}
        {next ? <div className="tl-behind" style={{ opacity: nextShown }} aria-hidden="true"><SectionCard s={next} direction="next" /></div> : null}
        {phase !== "ready" ? <div className="tl-behind tl-behind--current" aria-hidden="true"><SectionCard s={s} /></div> : null}
        <div ref={box} className="tl-scroll" onScroll={onScroll} tabIndex={0} aria-label={`${s.title}, ${s.subTitle}: the events by year. Scroll sideways along the years.`}>
          <div className="tl-world" data-from={fromNext ? "next" : "prev"} style={{ width: lead + g.width + (next ? vw : 0), height: g.height }}>
            {prev ? <button type="button" className="tl-panel" style={{ left: 0, width: vw }} onClick={() => go(index - 1, "next")} aria-label={`Previous period: ${prev.title}`} /> : null}
            <div className="tl-canvas" style={{ left: lead, width: g.width, height: g.height }}>
              {s.events.map((e) => <Bar key={`${e.id}-${e.slug}`} e={e} g={g} onOpen={opened} />)}
              <div className="tl-datebar" style={{ width: g.width, paddingLeft: g.offset }} aria-hidden="true">
                {marks.map((year, i) => <span key={year} style={{ left: g.offset + i * 100 }}>{year < 2020 ? Math.abs(year) : "Future"}</span>)}
              </div>
            </div>
            {next ? <button type="button" className="tl-panel" style={{ left: lead + g.width, width: vw }} onClick={() => go(index + 1)} aria-label={`Next period: ${next.title}`} /> : null}
          </div>
        </div>
      </div>
      <i className="tl-line" style={{ left: g.offset, transform: past ? `translateX(${past}px)` : undefined }} aria-hidden="true" />
      <div className="tl-current" style={past ? { transform: `translateX(${past}px)` } : undefined}>
        {prev ? <button type="button" className="tl-current__nav" style={{ left: 0, color: prev.color }} aria-label={`Previous period: ${prev.title}`} onClick={() => go(index - 1, "next")}><Feather name="chevrons-left" size={20} color="currentColor" /></button> : null}
        <output className="tl-current__year" style={{ left: g.offset - 50 }} aria-live="polite">{g.yearAt(Math.min(end, Math.max(0, left)))}</output>
        {next ? <button type="button" className="tl-current__nav tl-current__nav--next" style={{ color: next.color }} aria-label={`Next period: ${next.title}`} onClick={() => go(index + 1)}><Feather name="chevrons-right" size={20} color="currentColor" /></button> : null}
        <i className="tl-current__progress" style={{ width: `${g.progress(Math.min(end, Math.max(0, left)))}%` }} aria-hidden="true" />
      </div>
      {details ? <Panel title={s.sectionTitle} onClose={() => setDetails(false)}><PeriodDetails s={s} /></Panel> : null}
    </main>
  );
}

/** SectionDetailsModal: the period's card with its picture; in place of their description, the case studies on its events. */
function PeriodDetails({ s }: { s: TimelineSection }) {
  if (s.events.some((e) => e.fc)) return <FcPeriodDetails s={s} />;
  const withCases = s.events.filter((e) => e.cases?.length);
  return (
    <div className="tl-details">
      <SectionCard s={s} />
      <PhotoEdit slot={`period:${s.id}`} label="Period cover" shape="cover" hasPhoto={PERIOD_PICTURES.has(s.id)} />
      {withCases.length ? (
        <>
          <h2 className="entity__eyebrow">Case studies in this period<span> · {withCases.reduce((n, e) => n + e.cases!.length, 0)}</span></h2>
          <ul className="tl-details__list">{withCases.map((e) => <li key={e.slug}><Link to={`/timeline/event/${e.slug}`} onClick={() => haptic("select")}><b>{e.title}</b><span>{calculateLabel(e.start, e.end)}</span></Link></li>)}</ul>
        </>
      ) : <p className="hint">No case study is on an event of this period yet.</p>}
    </div>
  );
}

/** A Final Captivity period's details: its events by research category, in time order within each. */
function FcPeriodDetails({ s }: { s: TimelineSection }) {
  const groups = new Map<string, TimelineEvent[]>();
  for (const e of s.events) groups.set(e.group ?? "Events", [...(groups.get(e.group ?? "Events") ?? []), e]);
  return (
    <div className="tl-details">
      <SectionCard s={s} />
      <PhotoEdit slot={`period:${s.id}`} label="Period cover" shape="cover" hasPhoto={PERIOD_PICTURES.has(s.id)} />
      <p className="hint">More events are being added to this period as each one is checked against the classes and the sources.</p>
      {[...groups].map(([g, list]) => (
        <section key={g}>
          <h2 className="entity__eyebrow">{g}<span> · {list.length}</span></h2>
          <ul className="tl-details__list">{list.map((e) => <li key={e.slug}><Link to={`/timeline/event/${e.slug}`} onClick={() => haptic("select")}><b>{e.title}</b><span>{calculateLabel(e.start, e.end)}</span></Link></li>)}</ul>
        </section>
      ))}
      {FINAL_CAPTIVITY ? <p className="hint">Sources reviewed through {reviewed(FINAL_CAPTIVITY.reviewedThrough)}.</p> : null}
    </div>
  );
}

/**
 * TimelineEvent: a bar from its start year, on its row. A major event is 60px tall with its
 * title and date, which ride along the bar as it scrolls by, and its picture at the right end; a
 * minor one is a 25px pill. An event with nothing to open is dimmed and does not open, as theirs
 * without details.
 */
function Bar({ e, g, onOpen }: { e: TimelineEvent; g: ReturnType<typeof geometry>; onOpen: (slug: string) => void }) {
  const open = hasDetails(e);
  const label = calculateLabel(e.start, e.end);
  const style: CSSProperties = { top: rowToPx(e.row), left: g.yearsToPx(e.start) + g.offset };
  const pic = portraitSrc(e, 128, usePhotos().data);
  const inner = e.type === "minor"
    ? <><span className="tl-minor__title">{e.title}</span><span className="tl-minor__date">{label}</span></>
    : <>
        <span className="tl-major__ride"><span className="tl-major__desc"><span className="tl-major__title">{e.title}</span><i aria-hidden="true" /><span className="tl-major__date">{label}</span></span></span>
        <span className="tl-major__pic" aria-hidden="true">{pic ? <img src={pic} alt="" width={60} height={60} loading="lazy" decoding="async" draggable={false} /> : <span className="tl-major__letter">{e.title.replace(/^(the|a|an)\s+/i, "").charAt(0).toUpperCase()}</span>}</span>
      </>;
  const cls = e.type === "minor" ? "tl-minor" : "tl-major";
  if (e.type !== "minor") style.width = g.eventWidth(e.start, e.end, e.isFixed);
  return open
    ? <Link to={`/timeline/event/${e.slug}`} className={cls} style={style} data-slug={e.slug} data-cases={e.cases?.length || undefined}
        // A tap does not move the canvas: focus from a pointer would scroll the bar into view first.
        onMouseDown={(ev) => ev.preventDefault()} onClick={() => { haptic("select"); onOpen(e.slug); }}>{inner}</Link>
    : <span className={cls} style={style} data-off="">{inner}</span>;
}

/** Events to try, among those that open, for the empty search. */
const TRY = ["Solomon", "Moses", "Ahaziah", "Esther", "853", "Cain"];

/**
 * TimelineSearchScreen, in the main search's field and list (ui/search-bar, Search.tsx): results
 * as the words are typed (their 250ms), Enter keeps the search in the address and in recent
 * searches, the matched words lit, the keyboard through it all; each result its event's
 * picture, title and date, and the reign and case studies under it.
 */
export function TimelineSearch() {
  useBackButton(false);
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const [input, setInput] = useState(q);
  const [recent, setRecent] = useStored<string[]>("tl-recent", []);
  const results = useRef<HTMLDivElement>(null);
  useEffect(() => { setInput(q); }, [q]);
  const settled = useSettled(input, 250);
  const term = input.trim() === q.trim() ? q : settled;
  const found = useMemo(() => searchEvents(SECTIONS, term), [term]);
  const photos = usePhotos().data;
  // Typing keeps the words in the address (replaced, not stacked), so coming back finds them.
  useEffect(() => {
    if (term.trim() === q.trim()) return;
    setParams(term.trim() ? { q: term.trim() } : {}, { replace: true });
  }, [term]); // eslint-disable-line react-hooks/exhaustive-deps
  useKeptScroll(true);
  const submit = (text = input) => {
    const t = text.trim(); if (!t) return;
    hideKeyboard();
    setRecent([t, ...recent.filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, 8));
    setParams({ q: t }, { replace: true });
  };
  const choose = (text: string) => { setInput(text); submit(text); };
  const typed = term.trim();
  return (
    <main className="screen srch tl-search">
      <Header title="Search" />
      <SearchBar id="tl-search" value={input} onChange={setInput} onSubmit={() => submit()} onCancel={() => { setInput(""); setParams({}, { replace: true }); }}
        placeholder="Search for an event in the Bible" autoFocus={!q} results={results} controls="tl-results" />
      <p className="sr-only" aria-live="polite">{typed ? `${found.length} ${found.length === 1 ? "event" : "events"} for ${typed}` : ""}</p>
      <div id="tl-results" ref={results} className="srch__results">
        {!typed ? (
          <div className="srch__start">
            {recent.length ? (
              <section aria-labelledby="tl-recent">
                <div className="srch__head"><h2 id="tl-recent">Recent</h2><button type="button" className="link" onClick={() => setRecent([])}>Clear</button></div>
                <ul className="srch__recent">
                  {recent.map((r) => (
                    <li key={r}>
                      <button type="button" data-result="" className="srch__recentbtn" onClick={() => choose(r)}><Icon name="clock" size={16} /><span>{r}</span></button>
                      <button type="button" className="srch__forget" aria-label={`Remove ${r} from recent searches`} onClick={() => setRecent(recent.filter((x) => x !== r))}><Icon name="close" size={12} /></button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            <div className="srch__empty">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-4.2-4.2" /></svg>
              <p>Search the Bible Timeline: a person, a king, an event, or a year such as <b>853</b>.</p>
              <div className="srch__try">{TRY.map((t) => <button key={t} type="button" data-result="" onClick={() => choose(t)}>{t}</button>)}</div>
            </div>
          </div>
        ) : found.length ? (
          <section className="srch__group" aria-label="Events">
            <div className="srch__head"><h2>Events<span className="srch__count">{found.length}</span></h2></div>
            <ul className="srch__list srch__list--full tl-search__list">
              {found.map((e) => {
                const pic = portraitSrc(e, 128, photos);
                const sub = [e.reign ? `Reign ${reignLabel(e.reign)}` : "", (e.cases ?? []).map((c) => c.name).join(" · ")].filter(Boolean).join(" · ");
                return (
                  <li key={e.slug}>
                    <Link to={`/timeline/event/${e.slug}`} data-result="" className="srch__hit" onClick={() => haptic("select")}>
                      {pic ? <img className="tl-search__pic" src={pic} alt="" width={70} height={70} loading="lazy" decoding="async" /> : <span className="srch__kind" data-kind="history"><Icon name="history" size={18} /></span>}
                      <span className="srch__body">
                        <span className="srch__title"><Lit text={`${e.title} (${calculateLabel(e.start, e.end)})`} needle={typed} /></span>
                        {sub ? <span className="srch__snip"><Lit text={sub} needle={typed} /></span> : null}
                      </span>
                      <span className="srch__go" aria-hidden="true"><Icon name="chevron" size={16} /></span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : (
          <div className="srch__none" role="status">
            <b>No results for “{typed}”</b>
            <p>Try fewer words, another spelling, or a year such as 853. Only events with a case study or a reign open.</p>
          </div>
        )}
      </div>
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
  const photos = usePhotos();
  // Back from a verse or a case study, the page is where it was once its verses are in.
  useKeptScroll(!cases.some((q) => q.isPending));
  if (!e) return (
    <main className="tl-event"><Header title="Bible timeline" /><Empty title="This event is no longer available.">Go back to <Link to="/timeline">the timeline</Link>.</Empty></main>
  );
  const s = SECTIONS[e.sectionIndex];
  const refs: ResolvedRef[] = cases.flatMap((q) => (q.data?.refsResolved ?? []).filter((r) => r.slug && r.text.length));
  const seen = new Set<string>();
  const verses = refs.filter((r) => (seen.has(r.label) ? false : (seen.add(r.label), true)));
  const linked = linkedEvents(SECTIONS, e.slug);
  const loading = cases.some((q) => q.isPending);
  const pic = portraitSrc(e, 256, photos.data);
  return (
    <main className="tl-event" style={{ ["--tl-color" as string]: s.color }}>
      <Header title={e.title} onMenu={menu} />
      <div className="tl-event__body">
        {pic ? <img className="tl-event__pic" src={pic} alt="" width={150} height={150} decoding="async" /> : null}
        {/* An admin sets the picture here: a leader's portrait (on every event about them), else this event's own. */}
        <PhotoEdit slot={e.leader ? `leader:${e.leader}` : `event:${e.slug}`} label={e.leader ? "Leader's portrait" : "Event photo"} hasPhoto={!!pic} />
        <div className="tl-event__head">
          <p className="tl-event__title">{e.title}</p>
          <p className="tl-event__date">{calculateLabel(e.start, e.end)}</p>
          <Link className="tl-event__period" to={`/timeline/${e.sectionIndex}`}>{s.title} · {s.subTitle}</Link>
        </div>

        {e.fc ? <FinalCaptivityDetail slug={e.slug} reviewedThrough={FINAL_CAPTIVITY?.reviewedThrough} /> : null}

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
