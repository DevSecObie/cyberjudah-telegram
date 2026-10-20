import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";

import { fmtDate } from "@/api/data";
import { Feather } from "@/bible/icons";
import { useKeptScroll, useVisitState } from "@/lib/place";
import { seriesLabel } from "@/lib/series";
import { useBackButton, useBottomButtons } from "@/tg/hooks";
import { haptic } from "@/tg/sdk";
import { FiltersButton, PanelSearch } from "@/ui/panel";
import { Empty, Icon, Img, Screen } from "@/ui/ui";
import { KIND_NAME, teachingTo, useTeachings, type Teaching } from "./Home";

type Feed = "all" | "classes" | "captains" | "history" | "truth";
const FEEDS: [Feed, string][] = [["all", "All"], ["classes", "Sabbath"], ["captains", "Captains"], ["history", "History"], ["truth", "Truth"]];
/** Each feed's section on the library page, in Bible Strong's SectionList order. */
const SECTIONS: [Exclude<Feed, "all">, string][] = [["classes", "Sabbath classes"], ["captains", "15 Min w/ Captains"], ["history", "Our Hidden History"], ["truth", "The Truth Shall Make You Free"]];
const TRUTH = "The Truth Shall Make You Free";
const PAGE = 12;
const inFeedOf = (f: Feed, t: Teaching) => f === "all" || (f === "history" ? t.kind === "history" : f === "captains" ? t.kind === "captains" : f === "truth" ? t.kind === "class" && t.collection === TRUTH : t.kind === "class" && t.collection !== TRUTH);

/**
 * Courses & videos (Bible Strong's PassageMediaLibraryScreen): the heading and subtitle, the latest
 * class featured, then a section per feed of PassageMediaLibraryCard rows. The filter button
 * (Bible Strong's FiltersHeader) searches and narrows them to one feed, teacher, year or series.
 */
export function Classes() {
  const [params, setParams] = useSearchParams();
  const feed = (FEEDS.some(([f]) => f === params.get("feed")) ? params.get("feed") : "all") as Feed;
  const teacher = params.get("teacher") ?? "", year = params.get("year") ?? "", series = params.get("series") ?? "";
  useBackButton();
  useBottomButtons(null, null);
  const [q, setQ] = useVisitState("q", "");
  const [shown, setShown] = useVisitState("shown", PAGE);
  const [feedNoticeOff, setFeedNoticeOff] = useState(false);
  const query = useDeferredValue(q.trim().toLowerCase());
  const res = useTeachings();
  useEffect(() => { if (res.feedOk !== false) setFeedNoticeOff(false); }, [res.feedOk]);
  useKeptScroll(!!res.data);
  const set = (next: Record<string, string | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries({ feed, teacher, year, series, ...next })) if (v && v !== "all") p.set(k, v); setParams(p, { replace: true }); setShown(PAGE); };
  const all = useMemo(() => {
    // One card per class: the notes and the channel's newest uploads can name the same recording.
    const seen = new Set<string>();
    return (res.data ?? []).filter((t) => { const k = t.video ?? t.url; if (seen.has(k)) return false; seen.add(k); return true; });
  }, [res.data]);
  const inFeed = useMemo(() => all.filter((t) => inFeedOf(feed, t)), [all, feed]);
  const counts = useMemo(() => Object.fromEntries(FEEDS.map(([f]) => [f, all.filter((t) => inFeedOf(f, t)).length])), [all]);
  const teachers = useMemo(() => [...new Set(inFeed.map((t) => t.teacher).filter(Boolean))].sort(), [inFeed]);
  const years = useMemo(() => [...new Set(inFeed.map((t) => t.date.slice(0, 4)).filter(Boolean))].sort().reverse(), [inFeed]);
  const seriesNames = useMemo(() => [...new Set(inFeed.map((t) => t.series?.name).filter((s): s is string => !!s))].sort(), [inFeed]);
  const rows = useMemo(() => {
    const out = inFeed.filter((t) => (!series || t.series?.name === series) && (!teacher || t.teacher === teacher) && (!year || t.date.startsWith(year)) && (!query || `${t.title} ${t.teacher} ${t.series?.name ?? ""} ${t.topics.join(" ")} ${t.books.join(" ")} ${(t.opens ?? []).map((o) => o.label).join(" ")}`.toLowerCase().includes(query)));
    // A series reads in its own order: part 1 first, then by date.
    return series ? out.sort((a, b) => (a.series?.part ?? 0) - (b.series?.part ?? 0) || a.date.localeCompare(b.date)) : out;
  }, [inFeed, series, teacher, year, query]);
  const filtered = !!(q.trim() || teacher || year || series || feed !== "all");
  const reset = () => { setQ(""); set({ feed: "all", teacher: undefined, year: undefined, series: undefined }); };
  const latest = all.find((t) => t.kind === "class");

  // More cards as the reader nears the end of a filtered list; the button stays for keyboards.
  const more = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = more.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) setShown((s) => (s < rows.length ? s + PAGE : s)); }, { rootMargin: "800px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [rows.length, setShown, res.data, filtered]);

  const choices = (current: string, options: string[], every: string, key: "teacher" | "year" | "series") =>
    [{ key: "", label: every, selected: !current, onSelect: () => set({ [key]: undefined }) }, ...options.map((o) => ({ key: o, label: o, selected: o === current, onSelect: () => set({ [key]: o }) }))];
  const feedLabel = FEEDS.find(([f]) => f === feed)?.[1] ?? "All";
  const resultsTitle = series || (SECTIONS.find(([f]) => f === feed)?.[1] ?? "Results");
  const filters = (
    <FiltersButton onReset={reset} filters={[
      { key: "search", icon: "search", label: "Search", value: q.trim() || undefined, active: !!q.trim(), content: () => <PanelSearch value={q} onChange={(v) => { setQ(v); setShown(PAGE); }} placeholder="Search classes, teachers, books" /> },
      { key: "feed", icon: "layers", label: "Collection", value: feedLabel, active: feed !== "all", options: FEEDS.map(([f, label]) => ({ key: f, label: res.data ? `${label} (${counts[f].toLocaleString()})` : label, selected: feed === f, onSelect: () => set({ feed: f, teacher: undefined, year: undefined, series: undefined }) })) },
      { key: "teacher", icon: "user", label: "Teacher", value: teacher || undefined, active: !!teacher, options: choices(teacher, teachers, "Every teacher", "teacher") },
      { key: "year", icon: "clock", label: "Year", value: year || undefined, active: !!year, options: choices(year, years, "Every year", "year") },
      { key: "series", icon: "list", label: "Series", value: series || undefined, active: !!series, options: choices(series, seriesNames, "Every class", "series") },
    ]} />
  );

  return (
    <Screen title="Courses & videos" className="pml" action={filters}>
      {res.feedOk === false && !feedNoticeOff ? (
        <div className="cfeed__notice" role="status">
          <Icon name="alert" size={16} />
          <p>New uploads may be delayed while YouTube is having trouble. Classes already listed are still available.</p>
          <button type="button" className="cfeed__noticex" aria-label="Dismiss upload notice" onClick={() => { haptic("select"); setFeedNoticeOff(true); }}><Icon name="close" size={14} /></button>
        </div>
      ) : null}
      <div className="pml__intro">
        <h2>Explore the Bible through video</h2>
        <p>The Sabbath classes, the Captains and Our Hidden History.</p>
      </div>
      {res.isPending ? <LibrarySkeleton /> : res.isError ? (
        <Empty title="The classes did not load" action={{ label: "Try again", onClick: () => void res.refetch() }}>Check your connection.</Empty>
      ) : filtered ? (
        rows.length ? (
          <section aria-label={resultsTitle}>
            <h3 className="pml__section">{resultsTitle}<small>{rows.length.toLocaleString()}</small></h3>
            {rows.slice(0, shown).map((t) => <MediaCard key={t.url} t={t} />)}
            <div ref={more} className="cfeed__more">
              {rows.length > shown ? <button type="button" className="cfeed__morebtn" onClick={() => setShown(shown + PAGE)}>Show more classes</button> : null}
            </div>
          </section>
        ) : <Empty title="No class matches that" action={{ label: "Reset the search", onClick: reset }}>Try a topic like “Passover”, or a book like “Isaiah”.</Empty>
      ) : (
        <>
          {latest ? <FeaturedCard t={latest} /> : null}
          {SECTIONS.map(([f, title]) => {
            const items = all.filter((t) => t !== latest && inFeedOf(f, t));
            if (!items.length) return null;
            return (
              <section key={f} aria-label={title}>
                <h3 className="pml__section">{title}</h3>
                {items.slice(0, PAGE).map((t) => <MediaCard key={t.url} t={t} />)}
                {items.length > PAGE ? <button type="button" className="pml__all" onClick={() => { haptic("select"); set({ feed: f }); window.scrollTo({ top: 0 }); }}>See all {counts[f].toLocaleString()}<Feather name="chevron-right" size={16} /></button> : null}
              </section>
            );
          })}
        </>
      )}
    </Screen>
  );
}

/** What a card's small primary line names (Bible Strong's "Episode N"): the episode, the series and its part, else the collection. */
const cardLabel = (t: Teaching) => t.sub ?? (t.series ? seriesLabel(t.series) : KIND_NAME[t.kind]);
/** Bible Strong's grey third line (the duration there): when, and who taught it. */
const cardMeta = (t: Teaching) => [t.date ? fmtDate(t.date) : "Date to come", t.teacher].filter(Boolean).join(" · ");

/** Bible Strong's PassageMediaLibraryCard: the 16:9 picture, then the label, the title and the meta line. */
function MediaCard({ t }: { t: Teaching }) {
  return (
    <Link to={teachingTo(t)} className="pml-card" onClick={() => haptic("select")}>
      <span className="pml-card__thumb">{t.thumb ? <Img src={t.thumb} /> : <span className="pml-card__noimg"><Icon name="play" size={22} /></span>}</span>
      <span className="pml-card__body">
        <b className="pml-card__label">{cardLabel(t)}</b>
        <span className="pml-card__title">{t.title}</span>
        <small className="pml-card__meta">{cardMeta(t)}{t.pending ? <span className="soon">Notes coming soon</span> : null}</small>
      </span>
    </Link>
  );
}

/** The latest class, above the sections: the card at full width, its picture on top. */
function FeaturedCard({ t }: { t: Teaching }) {
  return (
    <Link to={teachingTo(t)} className="pml-card pml-card--featured" onClick={() => haptic("select")}>
      <span className="pml-card__thumb">{t.thumb ? <Img src={t.thumb} eager /> : <span className="pml-card__noimg"><Icon name="play" size={28} /></span>}</span>
      <span className="pml-card__body">
        <b className="pml-card__label">Latest class</b>
        <span className="pml-card__title">{t.title}</span>
        <small className="pml-card__meta">{cardMeta(t)}{t.pending ? <span className="soon">Notes coming soon</span> : null}</small>
      </span>
    </Link>
  );
}

function LibrarySkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <span className="skel" style={{ display: "block", aspectRatio: "16 / 9", borderRadius: 12 }} />
      {[0, 1, 2].map((i) => (
        <div key={i} className="pml-card">
          <span className="pml-card__thumb"><span className="skel" style={{ position: "absolute", inset: 0, borderRadius: 12 }} /></span>
          <span className="pml-card__body"><span className="skel" style={{ width: 70, height: 10 }} /><span className="skel" style={{ width: "90%", height: 14 }} /><span className="skel" style={{ width: 110, height: 10 }} /></span>
        </div>
      ))}
    </div>
  );
}
