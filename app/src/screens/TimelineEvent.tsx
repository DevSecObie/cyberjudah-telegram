import { useQueries, useQuery } from "@tanstack/react-query";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router";

import { calculateLabel, linkedEvents } from "@shared/timeline.mjs";
import { data, type ResolvedRef } from "@/api/data";
import { Feather } from "@/bible/icons";
import { Sheet } from "@/bible/ui/Sheet";
import { ALL, SECTIONS, personOf, portraitSrc, reignLabel } from "@/lib/timeline";
import { haptic } from "@/tg/sdk";
import { avatarKind, EntityAvatar } from "@/ui/avatar";
import { ScriptureCard } from "@/ui/scripture";
import { Empty } from "@/ui/ui";

/**
 * An event, over the timeline: Bible Strong's event route presented as a form sheet
 * (features/timeline/EventScreen.tsx in an (explore) formSheet with detents [0.45, 1] and the
 * timeline mounted and usable under it; a right-hand panel on a wide web window). Here the event
 * is a search param (`?event=<slug>`) on the screen it was opened from, so that screen is never
 * unmounted: the period's canvas keeps its scroll, its year and its entrance state, and the
 * search keeps its words and results.
 *
 *   peek      the title, the date, the portrait and one line of context, the timeline above it
 *   expanded  the people, the reign and the scripture begin
 *   full      everything, scrolling: scripture with Go to verse, case studies, linked events
 *
 * Opening an event from the timeline replaces the one shown (one sheet, never a stack); a linked
 * event opened inside the sheet is pushed, so Back returns to the event before it. Closing (a
 * swipe down, the ✕, Escape, Telegram's back button) walks back past every event the sheet showed.
 */
type Event = (typeof ALL)[number];
const BY_SLUG = new Map<string, Event>(ALL.map((e) => [e.slug, e]));
const DETENTS = [0.42, 0.72, 1];
/** Verses shown of a long passage before "All n verses" (as a case study's scripture). */
const SHOWN_VERSES = 3;

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
 * at each detent, so the page under it can make room.
 */
export function TimelineEventSheet({ event, onClose, onOpen, onCover }: { event: Event; onClose: () => void; onOpen: (slug: string) => void; onCover?: (px: number) => void }) {
  const onDetent = (i: number) => onCover?.(Math.round(window.innerHeight * DETENTS[i]));
  useEffect(() => () => onCover?.(0), []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Sheet open onClose={onClose} detents={DETENTS} initialDetent={0} onDetent={onDetent} label={`${event.title}, ${calculateLabel(event.start, event.end)}`} className="tl-sheet">
      <EventDetail event={event} onOpen={onOpen} />
    </Sheet>
  );
}

/** An event's content, top first in the order the detents reveal it. */
const EventDetail = memo(function EventDetail({ event: e, onOpen }: { event: Event; onOpen: (slug: string) => void }) {
  const top = useRef<HTMLDivElement>(null);
  const s = SECTIONS[e.sectionIndex];
  // The case studies are cached for the session (staleTime Infinity): reopening an event fetches nothing.
  const cases = useQueries({ queries: (e.cases ?? []).map((c) => ({ queryKey: ["case", c.slug], queryFn: () => data.case(c.slug), staleTime: Infinity, retry: 1 })) });
  const people = useQuery({ queryKey: ["people-index"], queryFn: data.people, staleTime: Infinity, enabled: !!e.cases?.length || !!personOf(e) });
  const loading = cases.some((q) => q.isPending);
  // A new event in the same sheet starts at its top, and its title is announced.
  useEffect(() => { top.current?.closest(".bs-sheet__body")?.scrollTo({ top: 0 }); }, [e.slug]);

  const refs: ResolvedRef[] = cases.flatMap((q) => (q.data?.refsResolved ?? []).filter((r) => r.slug && r.text.length));
  const seen = new Set<string>();
  const verses = refs.filter((r) => (seen.has(r.label) ? false : (seen.add(r.label), true)));
  const who = useMemo(() => {
    const list = new Map<string, string>();
    const own = personOf(e);
    if (own) list.set(own, (people.data ?? []).find((p) => p.id === own)?.name ?? e.title);
    for (const q of cases) for (const p of q.data?.people ?? []) if (!list.has(p.id)) list.set(p.id, p.name);
    return [...list].slice(0, 12);
  }, [e, cases, people.data]);
  const typeOf = useMemo(() => new Map((people.data ?? []).map((p) => [p.id, p.type])), [people.data]);
  const linked = useMemo(() => linkedEvents(SECTIONS, e.slug), [e.slug]);
  const context = e.reign ? `Reign ${reignLabel(e.reign)}` : cases[0]?.data?.charge ?? (e.cases?.[0]?.name ?? "");
  const pic = portraitSrc(e, 256);

  return (
    <div className="tl-ev" ref={top} style={{ ["--tl-color" as string]: s.color }}>
      <header className="tl-ev__head" aria-live="polite">
        {pic ? <img className="tl-ev__pic" src={pic} alt="" width={64} height={64} decoding="async" /> : <span className="tl-ev__pic tl-ev__pic--none" aria-hidden="true">{e.title.replace(/^(the|a|an)\s+/i, "").charAt(0)}</span>}
        <div className="tl-ev__titles">
          <h2 className="tl-ev__title">{e.title}</h2>
          <p className="tl-ev__date">{calculateLabel(e.start, e.end)}<span aria-hidden="true"> · </span><span className="tl-ev__period">{s.title}</span></p>
        </div>
      </header>
      {context ? <p className="tl-ev__context">{context}{e.reign ? <span className="tl-ev__src"> · Who's Who in the Bible</span> : null}</p> : null}

      {who.length ? (
        <section className="tl-ev__section" aria-label="People">
          <h3>People</h3>
          <ul className="case__people">
            {who.map(([id, name]) => <li key={id}><Link to={`/person/${id}`} className="case__person" onClick={() => haptic("select")}><EntityAvatar name={name} kind={avatarKind(typeOf.get(id))} size={32} /><span>{name}</span><Feather name="chevron-right" size={14} color="currentColor" /></Link></li>)}
          </ul>
        </section>
      ) : null}

      {verses.length ? (
        <section className="tl-ev__section" aria-label="Scripture">
          <h3>Scripture</h3>
          <div className="tl-ev__verses">{verses.map((r) => <EventScripture key={r.label} r={r} />)}</div>
        </section>
      ) : loading && e.cases?.length ? <p className="hint" aria-busy="true">Loading the scripture…</p> : null}

      {e.cases?.length ? (
        <section className="tl-ev__section" aria-label="Case studies">
          <h3>Case studies</h3>
          <ul className="tl-ev__list">
            {e.cases.map((c, i) => {
              const k = cases[i]?.data;
              return <li key={c.slug}><Link to={k?.url ?? "/cases"} className="tl-related" data-kind={c.kind} onClick={() => haptic("select")}><span><b>{c.name}</b>{k?.charge ? <small>{k.charge}</small> : null}</span><Feather name="chevron-right" size={20} color="currentColor" /></Link></li>;
            })}
          </ul>
        </section>
      ) : null}

      {linked.length ? (
        <section className="tl-ev__section" aria-label="Linked events">
          <h3>Linked events</h3>
          <ul className="tl-ev__list">
            {linked.map((l) => <li key={l.slug}><button type="button" className="tl-related" onClick={() => { haptic("select"); onOpen(l.slug); }}><span><b>{l.title}</b><small>{calculateLabel(l.start, l.end)}{l.sectionIndex !== e.sectionIndex ? ` · ${SECTIONS[l.sectionIndex].title}` : ""}</small></span><Feather name="chevron-right" size={20} color="currentColor" /></button></li>)}
          </ul>
        </section>
      ) : null}
    </div>
  );
});

/** A passage as a scripture card: read here, then Go to verse on purpose (the first verses of a long one). */
function EventScripture({ r }: { r: ResolvedRef }) {
  const [all, setAll] = useState(false);
  const at = { slug: r.slug!, chapter: r.chapter, from: r.text[0].verse, to: r.text[r.text.length - 1].verse };
  const href = `/read/${r.slug}/${r.chapter}${r.verses ? `?v=${r.verses.replace(/\s+/g, "")}` : ""}`;
  const long = r.text.length > SHOWN_VERSES;
  return (
    <ScriptureCard at={at} label={r.label} href={href} verses={long && !all ? r.text.slice(0, SHOWN_VERSES) : r.text}
      extra={long ? <button type="button" className="scard__act" aria-expanded={all} onClick={() => { haptic("select"); setAll(!all); }}>{all ? "Fewer verses" : `All ${r.text.length} verses`}</button> : null} />
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
