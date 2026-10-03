import { useQueries, useQuery } from "@tanstack/react-query";
import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router";

import { calculateLabel, linkedEvents } from "@shared/timeline.mjs";
import { data, type ResolvedRef } from "@/api/data";
import { Feather } from "@/bible/icons";
import { Sheet } from "@/bible/ui/Sheet";
import { ALL, FINAL_CAPTIVITY, SECTIONS, personOf, portraitSrc, reignLabel } from "@/lib/timeline";
import { FinalCaptivityDetail } from "@/screens/TimelineFinalCaptivity";
import { haptic } from "@/tg/sdk";
import { refHref, refLabel, refOfPath, usePassage, type VerseRef } from "@/ui/scripture";
import { useSheet as useSheetMenu } from "@/ui/sheet";
import { newTab } from "@/lib/tabs";
import { Empty } from "@/ui/ui";

/**
 * An event, over the timeline: Bible Strong's event route presented as a form sheet
 * (features/timeline/EventScreen.tsx in an (explore) formSheet with detents [0.45, 1] and the
 * timeline mounted and usable under it; a right-hand panel on a wide web window). Here the event
 * is a search param (`?event=<slug>`) on the screen it was opened from, so that screen is never
 * unmounted: the period's canvas keeps its scroll, its year and its entrance state, and the
 * search keeps its words and results.
 *
 *   0.45  the picture, the title and the date, and the description beginning, the timeline above it
 *   full  everything, scrolling: the description, the verses, case studies, people, linked events
 *
 * Opening an event from the timeline replaces the one shown (one sheet, never a stack); a linked
 * event opened inside the sheet is pushed, so Back returns to the event before it. Closing (a
 * swipe down, the ✕, Escape, Telegram's back button) walks back past every event the sheet showed.
 */
type Event = (typeof ALL)[number];
const BY_SLUG = new Map<string, Event>(ALL.map((e) => [e.slug, e]));
/** Bible Strong's event form sheet: sheetAllowedDetents [0.45, 1]. */
const DETENTS = [0.45, 1];
/** Verses shown of a long passage before "All n verses" (as a case study's scripture). */
const SHOWN_VERSES = 3;
/** Passages shown under Verses (theirs carry two or three); the rest are in the case studies below. */
const SHOWN_PASSAGES = 4;

type SheetState = { eventDepth?: number };

/** The event shown over this screen, and the ways to change it. */
export function useEventSheet() {
  const { pathname, search, state } = useLocation();
  const navigate = useNavigate();
  const slug = new URLSearchParams(search).get("event");
  const depth = (state as SheetState | null)?.eventDepth ?? 0;
  const withEvent = useCallback((s: string | null) => {
    const q = new URLSearchParams(search);
    if (s) q.set("event", s); else q.delete("event");
    const str = q.toString();
    return `${pathname}${str ? `?${str}` : ""}`;
  }, [pathname, search]);
  /** Show an event: in place of the one shown ("replace"), or on top of it so Back returns to it ("push"). */
  const open = useCallback((s: string, how: "push" | "replace" = slug ? "replace" : "push") => {
    if (s === slug) return;
    navigate(withEvent(s), { replace: how === "replace", state: { eventDepth: how === "replace" ? Math.max(depth, 1) : depth + 1 } satisfies SheetState });
  }, [slug, depth, navigate, withEvent]);
  /** Close the sheet: back past every event it showed, or (opened by a link) the event taken off the address. */
  const close = useCallback(() => {
    if (depth > 0) navigate(-depth); else navigate(withEvent(null), { replace: true });
  }, [depth, navigate, withEvent]);
  return { slug, event: slug ? BY_SLUG.get(slug) : undefined, open, close };
}

/**
 * The sheet. It stays mounted while the event changes (a linked event, another bar tapped), so it
 * keeps its height and only its content changes; `onCover` hears how much of the screen it covers
 * at each detent, so the page under it can make room. Bible Strong's form sheet: detents 0.45 and
 * full, their header (the title at the left, ⋮ with "Open in a new tab"), floating over the period.
 */
export function TimelineEventSheet({ event, onClose, onOpen, onCover }: { event: Event; onClose: () => void; onOpen: (slug: string) => void; onCover?: (px: number) => void }) {
  const onDetent = (i: number) => onCover?.(Math.round(window.innerHeight * DETENTS[i]));
  useEffect(() => () => onCover?.(0), []); // eslint-disable-line react-hooks/exhaustive-deps
  const menu = useSheetMenu();
  const navigate = useNavigate();
  const path = `/timeline/${event.sectionIndex}?event=${encodeURIComponent(event.slug)}`;
  const more = async () => {
    haptic("select");
    const a = await menu.open({ items: [{ id: "tab", text: "Open in a new tab" }] });
    if (a?.id === "tab") { newTab(path); navigate(path); }
  };
  return (
    <Sheet open form onClose={onClose} detents={DETENTS} initialDetent={0} onDetent={onDetent} label={`${event.title}, ${calculateLabel(event.start, event.end)}`} className="tl-sheet"
      title={event.title} right={<button type="button" className="bs-iconbtn" aria-label="More" onClick={more}><Feather name="more-vertical" size={18} /></button>}>
      {/* Keyed by the event: another event cross-fades in, at its top. */}
      <EventDetail key={event.slug} event={event} onOpen={onOpen} />
    </Sheet>
  );
}

/**
 * An event, as Bible Strong's EventDetails lays it out: the 150px picture, the title and date
 * centred, Description (a bold line, then the text), Verses (the reference in grey, the first
 * three verses, the whole passage a link to the Bible), then our case studies and the people, and
 * Linked events as cards. The words are ours: the person's entry in People (STEPBible), the case
 * study, the reign from Who's Who.
 */
const EventDetail = memo(function EventDetail({ event: e, onOpen }: { event: Event; onOpen: (slug: string) => void }) {
  const top = useRef<HTMLDivElement>(null);
  const s = SECTIONS[e.sectionIndex];
  const own = personOf(e);
  // The case studies and the person are cached for the session (staleTime Infinity): reopening an event fetches nothing.
  const cases = useQueries({ queries: (e.cases ?? []).map((c) => ({ queryKey: ["case", c.slug], queryFn: () => data.case(c.slug), staleTime: Infinity, retry: 1 })) });
  const person = useQuery({ queryKey: ["person", own], queryFn: () => data.person(own!), staleTime: Infinity, enabled: !!own, retry: 1 });
  const books = useQuery({ queryKey: ["books"], queryFn: data.books, staleTime: Infinity });
  const loading = cases.some((q) => q.isPending) || (!!own && person.isPending);
  // A new event in the same sheet starts at its top.
  useEffect(() => { top.current?.closest(".bs-sheet__body")?.scrollTo({ top: 0 }); }, [e.slug]);

  const bookName = (slug: string) => books.data?.find((b) => b.slug === slug)?.book ?? slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const first = cases[0]?.data;
  const lead = person.data?.description || first?.summary || "";
  const article = [
    e.reign ? `Reigned ${reignLabel(e.reign)} (Who's Who in the Bible).` : "",
    person.data?.description && first?.summary ? first.summary : "",
  ].filter(Boolean);
  // Verses: the case studies' scripture; for a person with none, where the person is first named.
  const refs: ResolvedRef[] = cases.flatMap((q) => (q.data?.refsResolved ?? []).filter((r) => r.slug && r.text.length));
  const seen = new Set<string>();
  const caseVerses = refs.filter((r) => (seen.has(r.label) ? false : (seen.add(r.label), true))).slice(0, SHOWN_PASSAGES);
  const personVerses = caseVerses.length ? [] : (person.data?.verses ?? []).slice(0, 2).map(refOfPath).filter((r): r is VerseRef => !!r);
  const people = useMemo(() => {
    const list = new Map<string, string>();
    for (const q of cases) for (const p of q.data?.people ?? []) if (p.id !== own && !list.has(p.id)) list.set(p.id, p.name);
    return [...list].slice(0, 12);
  }, [cases, own]);
  const linked = useMemo(() => linkedEvents(SECTIONS, e.slug), [e.slug]);
  const pic = portraitSrc(e, 256);

  return (
    <div className="tl-event__body tl-event__body--sheet" ref={top} style={{ ["--tl-color" as string]: s.color }}>
      {/* A Final Captivity event without a picture opens on its summary, not a letter. */}
      {e.fc && !pic ? null : pic
        ? <img className="tl-event__pic" src={pic} alt="" width={150} height={150} decoding="async" onLoad={(ev) => { ev.currentTarget.dataset.loaded = ""; }} />
        : <span className="tl-event__pic tl-event__pic--none" aria-hidden="true">{e.title.replace(/^(the|a|an)\s+/i, "").charAt(0).toUpperCase()}</span>}
      <div className="tl-event__head">
        <p className="tl-event__title">{e.title}</p>
        <p className="tl-event__date">{calculateLabel(e.start, e.end)}</p>
      </div>

      {e.fc ? <FinalCaptivityDetail slug={e.slug} reviewedThrough={FINAL_CAPTIVITY?.reviewedThrough} /> : null}

      {e.fc ? null : lead || article.length ? (
        <section className="tl-event__section" aria-label="Description">
          <h3>Description</h3>
          {lead ? <p className="tl-event__lead">{lead}</p> : null}
          {article.map((t) => <p key={t} className="tl-event__article">{t}</p>)}
        </section>
      ) : loading ? <p className="hint" aria-busy="true">Loading…</p> : null}

      {caseVerses.length || personVerses.length ? (
        <section className="tl-event__section" aria-label="Verses">
          <h3>Verses</h3>
          {caseVerses.map((r) => (
            <Link key={r.label} className="tl-verse" to={`/read/${r.slug}/${r.chapter}${r.verses ? `?v=${r.verses.replace(/\s+/g, "")}` : ""}`} onClick={() => haptic("select")}>
              <span className="tl-verse__ref">{r.label}</span>
              <span className="tl-verse__text">{r.text.slice(0, SHOWN_VERSES).map((v) => <span key={v.verse}>{r.text.length > 1 ? <sup>{v.verse}</sup> : null}{v.text} </span>)}{r.text.length > SHOWN_VERSES ? "…" : null}</span>
            </Link>
          ))}
          {personVerses.map((r) => <PersonVerse key={`${r.slug}/${r.chapter}/${r.from}`} at={r} label={refLabel(r, bookName)} />)}
        </section>
      ) : null}

      {e.cases?.length ? (
        <section className="tl-event__section" aria-label="Case studies">
          <h3>Case studies</h3>
          {e.cases.map((c, i) => {
            const k = cases[i]?.data;
            return <Link key={c.slug} to={k?.url ?? "/cases"} className="tl-related" data-kind={c.kind} onClick={() => haptic("select")}><span><b>{c.name}</b>{k?.charge ? <small>{k.charge}</small> : null}</span><Feather name="chevron-right" size={22} color="currentColor" /></Link>;
          })}
        </section>
      ) : null}

      {own || people.length ? (
        <section className="tl-event__section" aria-label="People">
          <h3>People</h3>
          {own ? <Link to={`/person/${own}`} className="tl-related" onClick={() => haptic("select")}><span><b>{person.data?.name ?? e.title}</b></span><Feather name="chevron-right" size={22} color="currentColor" /></Link> : null}
          {people.map(([id, name]) => <Link key={id} to={`/person/${id}`} className="tl-related" onClick={() => haptic("select")}><span><b>{name}</b></span><Feather name="chevron-right" size={22} color="currentColor" /></Link>)}
        </section>
      ) : null}

      {linked.length ? (
        <section className="tl-event__section" aria-label="Linked events">
          <h3>Linked events</h3>
          {linked.map((l) => <button key={l.slug} type="button" className="tl-related" onClick={() => { haptic("select"); onOpen(l.slug); }}><span><b>{l.title}</b></span><Feather name="chevron-right" size={22} color="currentColor" /></button>)}
        </section>
      ) : null}
    </div>
  );
});

/** A verse the person is named in, as Bible Strong shows an event's verses: the reference in grey, the text, a link to the Bible. */
function PersonVerse({ at, label }: { at: VerseRef; label: string }) {
  const p = usePassage(at);
  return (
    <Link className="tl-verse" to={refHref(at)} onClick={() => haptic("select")}>
      <span className="tl-verse__ref">{label}</span>
      <span className="tl-verse__text">{p.isPending ? "…" : p.verses.map((v) => v.text).join(" ")}</span>
    </Link>
  );
}

/**
 * /timeline/event/:slug (an old link, a start param `timeline_event_<slug>`): the event's period
 * with the event's sheet open over it.
 */
export function TimelineEventRedirect() {
  const { slug = "" } = useParams();
  const e = BY_SLUG.get(slug);
  if (!e) return <main className="tl-event"><Empty title="This event is no longer available.">Go back to <Link to="/timeline">the timeline</Link>.</Empty></main>;
  return <Navigate to={`/timeline/${e.sectionIndex}?event=${encodeURIComponent(e.slug)}`} replace />;
}
