import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";

import { fmtDate } from "@/api/data";
import { toggleBookmark, useBookmarks } from "@/lib/marks";
import { useKeptScroll, useVisitState } from "@/lib/place";
import { share } from "@/lib/share";
import { useBackButton, useBottomButtons } from "@/tg/hooks";
import { haptic } from "@/tg/sdk";
import { useSheet } from "@/ui/sheet";
import { Chip, Chips, Empty, Icon, Screen, SearchField } from "@/ui/ui";
import { teachingLabel, teachingTo, useTeachings, type Teaching } from "./Home";

type Feed = "all" | "classes" | "captains" | "history" | "truth";
const FEEDS: [Feed, string][] = [["all", "All"], ["classes", "Sabbath"], ["captains", "Captains"], ["history", "History"], ["truth", "Truth"]];
const TRUTH = "The Truth Shall Make You Free";
const PAGE = 12;
const inFeedOf = (f: Feed, t: Teaching) => f === "all" || (f === "history" ? t.kind === "history" : f === "captains" ? t.kind === "captains" : f === "truth" ? t.kind === "class" && t.collection === TRUTH : t.kind === "class" && t.collection !== TRUTH);
const embed = (id: string) => `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&playsinline=1&rel=0`;

/**
 * The teachings as a feed of posts, the way Instagram lays one out: who taught it and when, the
 * recording, what you can do with it, then the title and the opening of the notes. A recording
 * plays in its post when asked, one at a time; the notes open on their own page.
 */
export function Classes() {
  const [params, setParams] = useSearchParams();
  const feed = (FEEDS.some(([f]) => f === params.get("feed")) ? params.get("feed") : "all") as Feed;
  const teacher = params.get("teacher") ?? "", year = params.get("year") ?? "", series = params.get("series") ?? "";
  useBackButton(true);
  useBottomButtons(null, null);
  const sheet = useSheet();
  const [q, setQ] = useVisitState("q", "");
  const [shown, setShown] = useVisitState("shown", PAGE);
  const [playing, setPlaying] = useState<string | null>(null);
  const [feedNoticeOff, setFeedNoticeOff] = useState(false);
  const query = useDeferredValue(q.trim().toLowerCase());
  const res = useTeachings();
  useEffect(() => { if (res.feedOk !== false) setFeedNoticeOff(false); }, [res.feedOk]);
  useKeptScroll(!!res.data);
  const set = (next: Record<string, string | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries({ feed, teacher, year, series, ...next })) if (v && v !== "all") p.set(k, v); setParams(p, { replace: true }); setShown(PAGE); setPlaying(null); };
  const all = useMemo(() => {
    // One post per class: the notes and the channel's newest uploads can name the same recording.
    const seen = new Set<string>();
    return (res.data ?? []).filter((t) => { const k = t.video ?? t.url; if (seen.has(k)) return false; seen.add(k); return true; });
  }, [res.data]);
  const inFeed = useMemo(() => all.filter((t) => inFeedOf(feed, t)), [all, feed]);
  const counts = useMemo(() => Object.fromEntries(FEEDS.map(([f]) => [f, all.filter((t) => inFeedOf(f, t)).length])), [all]);
  const teachers = useMemo(() => [...new Set(inFeed.map((t) => t.teacher).filter(Boolean))].sort(), [inFeed]);
  const years = useMemo(() => [...new Set(inFeed.map((t) => t.date.slice(0, 4)).filter(Boolean))].sort().reverse(), [inFeed]);
  const rows = useMemo(() => {
    const out = inFeed.filter((t) => (!series || t.series?.name === series) && (!teacher || t.teacher === teacher) && (!year || t.date.startsWith(year)) && (!query || `${t.title} ${t.teacher} ${t.series?.name ?? ""} ${t.topics.join(" ")} ${t.books.join(" ")} ${(t.opens ?? []).map((o) => o.label).join(" ")}`.toLowerCase().includes(query)));
    // A series reads in its own order: part 1 first, then by date.
    return series ? out.sort((a, b) => (a.series?.part ?? 0) - (b.series?.part ?? 0) || a.date.localeCompare(b.date)) : out;
  }, [inFeed, series, teacher, year, query]);
  const filtered = !!(q.trim() || teacher || year || series || feed !== "all");
  const reset = () => { setQ(""); set({ feed: "all", teacher: undefined, year: undefined, series: undefined }); };
  const choose = async (title: string, current: string, options: string[], key: "teacher" | "year") => {
    haptic("select");
    const a = await sheet.open({ title, items: [{ id: "", text: key === "year" ? "Every year" : "Every teacher", hint: current ? undefined : "Selected" }, ...options.map((o) => ({ id: o, text: o, hint: o === current ? "Selected" : undefined }))] });
    if (a) set({ [key]: a.id || undefined });
  };

  // More posts as the reader nears the end, so the feed never stops short; the button stays for keyboards.
  const more = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = more.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) setShown((s) => (s < rows.length ? s + PAGE : s)); }, { rootMargin: "800px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [rows.length, setShown, res.data]);

  return (
    <Screen title="Classes" className="classes">
      <div className="cfeed__tools">
        <SearchField id="class-q" value={q} onChange={(v) => { setQ(v); setShown(PAGE); }} placeholder="Search classes, teachers, books" />
        <div className="cfeed__series" role="group" aria-label="Series">
          <Chips>{FEEDS.map(([f, label]) => <Chip key={f} on={feed === f} onClick={() => set({ feed: f, teacher: undefined, year: undefined, series: undefined })}>{label}{res.data ? <span className="chip__n"> {counts[f]}</span> : null}</Chip>)}</Chips>
        </div>
        <div className="cfeed__filters">
          <button type="button" className="cfeed__pick" data-on={year ? "" : undefined} disabled={years.length < 2} aria-label={`Year: ${year || "any"}`} title={`Year: ${year || "any"}`} onClick={() => void choose("Year", year, years, "year")}><span>{year || "Any year"}</span><Icon name="chevron" size={14} /></button>
          <button type="button" className="cfeed__pick" data-on={teacher ? "" : undefined} disabled={teachers.length < 2} aria-label={`Teacher: ${teacher || "any"}`} title={`Teacher: ${teacher || "any"}`} onClick={() => void choose("Teacher", teacher, teachers, "teacher")}><span>{teacher || "Any teacher"}</span><Icon name="chevron" size={14} /></button>
          {series ? <button type="button" className="cfeed__pick" data-on="" aria-label={`Series: ${series}. Show every class`} title={`Series: ${series}. Show every class`} onClick={() => { haptic("select"); set({ series: undefined }); }}><span>{series}</span><Icon name="close" size={14} /></button> : null}
          {filtered ? <button type="button" className="cfeed__reset" onClick={() => { haptic("select"); reset(); }}>Reset</button> : null}
        </div>
      </div>
      {res.feedOk === false && !feedNoticeOff ? (
        <div className="cfeed__notice" role="status">
          <Icon name="alert" size={16} />
          <p>New uploads may be delayed while YouTube is having trouble. Classes already listed are still available.</p>
          <button type="button" className="cfeed__noticex" aria-label="Dismiss upload notice" onClick={() => { haptic("select"); setFeedNoticeOff(true); }}><Icon name="close" size={14} /></button>
        </div>
      ) : null}
      {res.isPending ? <FeedSkeleton /> : res.isError ? (
        <Empty title="The classes did not load" action={{ label: "Try again", onClick: () => void res.refetch() }}>Check your connection.</Empty>
      ) : !rows.length ? (
        <Empty title="No class matches that" action={{ label: "Reset the search", onClick: reset }}>Try a topic like “Passover”, or a book like “Isaiah”.</Empty>
      ) : (
        <>
          <p className="cfeed__count" aria-live="polite">{rows.length.toLocaleString()} {rows.length === 1 ? "class" : "classes"}</p>
          <div className="cfeed" role="feed" aria-label="Classes">
            {rows.slice(0, shown).map((t, i) => <ClassPost key={t.url} t={t} index={i} total={rows.length} playing={playing === t.url} onPlay={(on) => setPlaying(on ? t.url : null)} onSeries={series ? undefined : (name) => { set({ series: name }); window.scrollTo({ top: 0 }); }} />)}
          </div>
          <div ref={more} className="cfeed__more">
            {rows.length > shown ? <button type="button" className="cfeed__morebtn" onClick={() => setShown(shown + PAGE)}>Show more classes</button> : <p className="cfeed__end">You’re all caught up</p>}
          </div>
        </>
      )}
    </Screen>
  );
}

/** The teacher's mark beside a post: their initial (titles left off), or the series' when no teacher is named. */
function TeacherMark({ t }: { t: Teaching }) {
  const name = t.teacher.replace(/^(Bishop|Deacon|Captain|Elder|Brother|Sister|Officer|Priest|Chief|Minister|Lieutenant|Sergeant)\s+/i, "");
  const letter = (name.match(/[A-Za-z]/)?.[0] ?? "").toUpperCase();
  let h = 0; for (const c of t.teacher || t.kind) h = (h * 31 + c.charCodeAt(0)) % 360;
  return <span className="post__mark" aria-hidden="true" style={{ ["--mark-h" as string]: String(h) }}>{letter || <Icon name="play" size={14} />}</span>;
}

function ClassPost({ t, index, total, playing, onPlay, onSeries }: { t: Teaching; index: number; total: number; playing: boolean; onPlay: (on: boolean) => void; onSeries?: (name: string) => void }) {
  const [marks, setMarks] = useBookmarks();
  const [open, setOpen] = useState(false);
  const [scripture, setScripture] = useState(false);
  const [clamped, setClamped] = useState(false);
  const intro = useRef<HTMLParagraphElement>(null);
  const to = teachingTo(t);
  const kept = marks.some((m) => m.id === t.url);
  const id = `post-${index}`;
  const opens = t.opens ?? [];
  const label = [teachingLabel(t), t.sub].filter(Boolean).join(" · ");
  // A series name opens the rest of the series.
  const series = t.series && onSeries ? <button type="button" className="post__series" onClick={() => { haptic("select"); onSeries(t.series!.name); }}>{label}</button> : label;
  // "Read more" only where the preview is actually cut.
  useLayoutEffect(() => {
    const el = intro.current; if (!el || open) return;
    const measure = () => setClamped(el.scrollHeight > el.clientHeight + 1);
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [t.intro, open]);

  return (
    <article className="post" aria-labelledby={id} aria-posinset={index + 1} aria-setsize={total}>
      <header className="post__head">
        <TeacherMark t={t} />
        <div className="post__who">
          <b>{t.teacher || (t.series ? series : teachingLabel(t))}</b>
          <span>{t.teacher ? <>{series} · </> : t.sub ? `${t.sub} · ` : ""}{t.date ? <time dateTime={t.date}>{fmtDate(t.date)}</time> : "Date to come"}</span>
        </div>
        {!t.pending ? (
          <div className="post__tools">
            <button type="button" className="post__icon" aria-label={`Share ${t.title}`} title={`Share ${t.title}`} onClick={() => { haptic("select"); void share({ kind: "note", title: t.title, text: teachingLabel(t), sitePath: t.url }); }}><Icon name="share" size={20} /></button>
            <button type="button" className="post__icon" aria-pressed={kept} aria-label={kept ? "Remove from saved" : "Save"} title={kept ? "Remove from saved" : "Save"} onClick={() => { haptic(kept ? "tap" : "success"); setMarks(toggleBookmark(marks, { id: t.url, kind: "note", title: t.title, text: [teachingLabel(t), fmtDate(t.date)].filter(Boolean).join(" · "), href: t.url })); }}><Icon name={kept ? "bookmarkFill" : "bookmark"} size={20} /></button>
          </div>
        ) : null}
      </header>

      <div className="post__media">
        {playing && t.video ? (
          <iframe src={embed(t.video)} title={t.title} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen />
        ) : t.video ? (
          <button type="button" className="post__poster" aria-label={`Play ${t.title}`} title={`Play ${t.title}`} onClick={() => { haptic("select"); onPlay(true); }}>
            <Poster src={t.thumb} />
            <span className="post__playicon" aria-hidden="true"><Icon name="play" size={22} /></span>
          </button>
        ) : (
          <Link to={to} className="post__poster" aria-label={`Open ${t.title}`}><Poster src={t.thumb} /></Link>
        )}
      </div>

      <div className="post__actions">
        {t.video ? (
          <button type="button" className="post__act" aria-pressed={playing} onClick={() => { haptic("select"); onPlay(!playing); }}>
            <Icon name={playing ? "close" : "play"} size={18} /><span>{playing ? "Stop" : "Watch"}</span>
          </button>
        ) : null}
        {!t.pending ? <Link to={to} className="post__act" onClick={() => haptic("select")}><Icon name="note" size={18} /><span>Notes</span></Link> : null}
        {opens.length ? (
          <button type="button" className="post__act" aria-expanded={scripture} aria-controls={`${id}-s`} onClick={() => { haptic("select"); setScripture(!scripture); }}>
            <Icon name="book-open" size={18} /><span>Scripture <small>{opens.length}</small></span>
          </button>
        ) : null}
      </div>

      {scripture && opens.length ? (
        <div className="post__scripture" id={`${id}-s`}>
          <small>Opened in this class, in order</small>
          <div>{opens.map((o, i) => <Link key={`${o.slug}-${o.chapter}-${i}`} to={`/read/${o.slug}/${o.chapter}`} className="post__ref" onClick={() => haptic("select")}>{o.label}</Link>)}</div>
        </div>
      ) : null}

      <div className="post__body">
        <h2 id={id} className="post__title"><Link to={to}>{t.title}</Link></h2>
        {t.intro ? (
          <>
            <p ref={intro} className="post__intro" data-open={open ? "" : undefined}>{t.intro}</p>
            {open ? <Link to={to} className="post__more">Read the full notes</Link> : clamped ? <button type="button" className="post__more" onClick={() => { haptic("select"); setOpen(true); }}>Read more</button> : null}
          </>
        ) : t.pending ? <p className="post__soon">Notes for this class are coming soon. You can watch it now.</p> : null}
      </div>
    </article>
  );
}

/** The recording's picture at 16:9, its space held before it loads; a quiet tile when there is none. */
/** YouTube's 320px still blurs on a wide feed: offer its 480px one too (its letterbox is cropped by object-fit). */
const sharper = (src: string) => /\/mqdefault\.jpg$/.test(src) ? `${src} 320w, ${src.replace(/mqdefault\.jpg$/, "hqdefault.jpg")} 480w` : undefined;

function Poster({ src }: { src: string }) {
  const [failed, setFailed] = useState(!src);
  return failed ? <span className="post__noimg"><Icon name="play" size={28} /></span> : <img src={src} srcSet={sharper(src)} sizes="(min-width: 700px) 600px, 100vw" alt="" width={320} height={180} loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}

function FeedSkeleton() {
  return (
    <div className="cfeed" aria-busy="true" aria-label="Loading">
      {[0, 1].map((i) => (
        <div key={i} className="post">
          <div className="post__head"><span className="skel" style={{ width: 36, height: 36, borderRadius: 18 }} /><span className="post__who"><span className="skel" style={{ width: 120, height: 12 }} /><span className="skel" style={{ width: 160, height: 10, marginTop: 6 }} /></span></div>
          <div className="post__media"><span className="skel" style={{ position: "absolute", inset: 0, borderRadius: 0 }} /></div>
          <div className="post__body"><span className="skel" style={{ width: "80%", height: 16 }} /><span className="skel" style={{ width: "95%", height: 12, marginTop: 8 }} /><span className="skel" style={{ width: "70%", height: 12, marginTop: 6 }} /></div>
        </div>
      ))}
    </div>
  );
}
