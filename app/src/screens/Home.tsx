import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";

import { data, fmtDate, type FeedRow, type HistoryRow, type Opened } from "@/api/data";
import { toAppPath } from "@shared/links.mjs";
import { orderTeachings } from "@shared/teaching-order.mjs";
const toApp = (sitePath: string) => toAppPath(sitePath) ?? sitePath;
import { pullStyle, usePullToRefresh } from "@/lib/pull";
import { planDay, schedule } from "@/lib/plan";
import { share } from "@/lib/share";
import { useLast, useLastNote, usePlan, useProgress } from "@/lib/marks";
import { countdown, sabbath } from "@/lib/sun";
import { useBackButton, useBottomButtons, useStored } from "@/tg/hooks";
import { api } from "@/tg/sdk";
import { haptic, user } from "@/tg/sdk";
import { Card, Icon, Img, Screen, Section, Skeleton, thumbOf, type IconName } from "@/ui/ui";
import { assetUrl } from "@/lib/asset";
import { SearchHero } from "@/ui/search-hero";
import { PersonOfTheDay, PreceptOfTheDay, StrongOfTheDay, StudyStats, TopicOfTheDay, WordOfTheDay, useRandomVerse } from "./home-widgets";

import { seriesLabel, seriesOf, showOf, type Series } from "@/lib/series";
import { TodayCard, type DailyVerse as Verse } from "./TodayCard";
export type LiveNow = { live: boolean; upcoming: boolean; video: string | null; title: string | null; starts: string | null };
/** Whether a class is on the air, asked again every minute while Home is open. */
export const useLive = (enabled = true) => useQuery({ queryKey: ["live"], queryFn: () => api<LiveNow>("/api/live"), enabled, refetchInterval: 60_000, staleTime: 45_000, retry: false });
export type Teaching = { kind: "class" | "captains" | "history"; url: string; title: string; date: string; broadcastAt?: string; teacher: string; thumb: string; topics: string[]; books: string[]; sub?: string; collection?: string; video?: string; pending?: boolean; intro?: string; opens?: Opened[]; series?: Series };
export type RecentVideo = { video: string; title: string; published: string; views: number | null };
/** The video behind a teaching's thumbnail: YouTube's own (/vi/<id>/) or the site's local copy (/img/<feed>/<id>.jpg). */
const videoOfThumb = (thumb: string) => /(?:\/vi(?:_webp)?\/|\/img\/[a-z]+\/)([A-Za-z0-9_-]{11})(?=[/.])/.exec(thumb ?? "")?.[1] ?? null;
/** Where a teaching opens: its notes, or the recording itself while the notes are still coming. */
export const teachingTo = (t: Teaching) => (t.pending && t.video ? `/watch/${encodeURIComponent(t.video)}` : `/note${t.url}`);
/** The channel's newest uploads, so a class is in the app before its notes are written. `feedOk` reports RSS health; a channel fallback may still supply recordings. */
export const useRecent = () => useQuery({ queryKey: ["recent"], queryFn: () => api<{ videos: RecentVideo[]; feedOk?: boolean }>("/api/recent"), staleTime: 10 * 60_000, refetchInterval: (q) => q.state.data?.feedOk === false ? 60_000 : 10 * 60_000, retry: false });
// Weeks start on the Sabbath (Saturday). The featured class is labeled by the
// calendar week its date falls in, so a stale feed never claims "this week".
const weekLabel = (dateStr: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
  if (!m) return "";
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  const weekStart = (x: Date) => {
    const t = new Date(x.getFullYear(), x.getMonth(), x.getDate());
    t.setDate(t.getDate() - ((t.getDay() + 1) % 7)); // back to Saturday
    return t;
  };
  const thisSat = weekStart(new Date());
  const lastSat = new Date(thisSat);
  lastSat.setDate(lastSat.getDate() - 7);
  if (d >= thisSat) return "This week's class";
  if (d >= lastSat) return "Last week's class";
  return "";
};
export const KIND_NAME: Record<Teaching["kind"], string> = { class: "Sabbath class", captains: "15 Min w/ Captains", history: "Our Hidden History" };
/** What a teaching is shown as: the series its title names, else its collection. */
export const teachingLabel = (t: Pick<Teaching, "kind" | "series">) => (t.series ? seriesLabel(t.series) : KIND_NAME[t.kind]);

/** Everything with notes, newest first, in one feed. */
function useNotedTeachings() {
  return useQuery({
    queryKey: ["teachings"],
    queryFn: async (): Promise<Teaching[]> => {
      const [classes, captains, history] = await Promise.all([data.classes(), data.captains(), data.history().catch(() => [] as HistoryRow[])]);
      const row = (kind: Teaching["kind"]) => (r: FeedRow): Teaching => ({ kind, url: r.url, title: r.title, date: r.date, teacher: r.teacher, thumb: r.thumb, topics: r.topics ?? [], books: r.books ?? [], collection: r.collection, video: r.videoId ?? videoOfThumb(r.thumb) ?? undefined, intro: r.intro, opens: r.opens });
      const hist = history.map<Teaching>((r) => ({ kind: "history", url: r.url, title: r.title, date: r.date ?? "", teacher: r.teacher, thumb: r.thumb, topics: r.topics, books: [], sub: r.episode ? `Episode ${r.episode}` : undefined, video: r.videoId || undefined, intro: r.intro }));
      return [...classes.map(row("class")), ...captains.map(row("captains")), ...hist].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    },
    staleTime: 10 * 60_000,
  });
}

/** In the order the classes went live, newest first, including pending notes. */
export function useTeachings() {
  const notes = useNotedTeachings();
  const recent = useRecent();
  const broadcasts = useQuery({ queryKey: ["class-broadcasts"], queryFn: () => data.broadcasts(), staleTime: 10 * 60_000, retry: false });
  const teachings = useMemo(() => {
    if (!notes.data) return notes.data;
    const have = new Set(notes.data.map((t) => t.video ?? videoOfThumb(t.thumb)).filter(Boolean));
    const extra = (recent.data?.videos ?? []).filter((v) => !have.has(v.video)).map<Teaching>((v) => ({ kind: "class", url: `/watch/${v.video}`, title: v.title, date: v.published.slice(0, 10), teacher: "", thumb: thumbOf(v.video), topics: [], books: [], video: v.video, pending: true }));
    const all = orderTeachings([...notes.data, ...extra], broadcasts.data);
    // A class taught as one of a run, or on one of the shows, carries that name, read from the titles.
    const series = seriesOf(all.filter((t) => t.kind === "class").map((t) => t.title));
    return all.map((t) => {
      if (t.kind !== "class") return t;
      const s = series.get(t.title) ?? (showOf(t.title) ? { name: showOf(t.title)! } : undefined);
      return s ? { ...t, series: s } : t;
    });
  }, [notes.data, recent.data, broadcasts.data]);
  return { ...notes, data: teachings, feedOk: recent.data?.feedOk };
}

/** The Learn shelf: where the teaching is kept, each its own door (Bible Strong's learning cards). */
const LEARN: [string, string, string, IconName][] = [
  ["/classes", "Classes", "Every Sabbath class, with its notes", "play"],
  ["/books", "Library", "The books the classes read from", "layers"],
  ["/classes?feed=history", "Our Hidden History", "The episodes, with their notes", "history"],
  ["/encyclopedia", "Encyclopedia", "Standing subjects, book by book", "book"],
];
/** The Law shelf. */
const LAW: [string, string, string, IconName][] = [
  ["/law", "The Law", "Every law with its scripture", "law"],
  ["/precepts", "Precepts", "Every subject scripture speaks to", "quote"],
  ["/cases", "Case studies", "Judgments, and those who were blessed", "folder"],
  ["/timeline", "Bible timeline", "Periods and events by year", "clock"],
  ["/topics", "Topics", "Classes and episodes by subject", "tag"],
];
/** The Study shelf: the reference works, each browsable on its own. */
const TOOLS: [string, string, IconName][] = [
  ["/lexicon", "Lexicon", "spark"], ["/dictionary", "Dictionary", "type"], ["/people", "People", "star"], ["/relations", "Your precepts", "precepts"], ["/bookmarks", "Kept", "bookmark"], ["/tags", "Tags", "tag"],
];

/**
 * Home is the front door: the search of what was said in the classes, Ask CyberJudah, then
 * where you left off, this week's class and the latest teachings.
 */
export function Home() {
  useBackButton(true);
  useBottomButtons(null, null);
  return <HomeBody />;
}

/** Home's content, on its own page or in Bible Strong's Home drawer over the current tab. */
export function HomeBody({ drawer = false, active = true }: { drawer?: boolean; active?: boolean }) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [last] = useLast();
  const [lastNote] = useLastNote();
  const [plan] = usePlan();
  const [progress] = useProgress();
  const books = useQuery({ queryKey: ["books"], queryFn: data.books, staleTime: Infinity });
  const { pull, busy } = usePullToRefresh(active);
  const ps = pullStyle(pull, busy);
  const sched = plan && books.data ? schedule(plan, books.data, progress) : null;
  const today = plan && books.data ? planDay(plan, books.data, progress) : null;
  const todayRead = today ? today.chapters.filter((c) => c.read).length : 0;
  const lastBook = last && books.data ? books.data.find((b) => b.slug === last.slug) : null;
  const lastRead = last ? (progress[last.slug] ? String(progress[last.slug]).split(",").reduce((n, r) => { const [a, b] = r.split("-").map(Number); return n + (b ? b - a + 1 : 1); }, 0) : 0) : 0;
  const [loc] = useStored<{ lat: number; lng: number } | null>("loc", null);
  const verse = useQuery({ queryKey: ["votd", new Date().toISOString().slice(0, 10)], queryFn: async () => { const r = await fetch("/api/verse-of-day"); if (!r.ok) throw new Error("Daily verse unavailable"); return r.json() as Promise<Verse>; }, staleTime: 60 * 60_000 });
  const feed = useTeachings();
  const stats = useQuery({ queryKey: ["stats"], queryFn: data.stats, staleTime: 60 * 60_000 });
  const live = useLive();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(t); }, []);
  const sab = loc ? sabbath(now, loc.lat, loc.lng) : null;
  const search = (text: string) => { const t = text.trim(); if (t) navigate(`/search?q=${encodeURIComponent(t)}`); };

  const random = useRandomVerse();
  // Precept passes are working data behind the verse notes, not something to read on their own.
  const whatsNew = useMemo(() => (stats.data?.whatsNew ?? []).filter((w) => w.kind !== "pass"), [stats.data]);
  const latestClass = feed.data?.find((t) => t.kind === "class");
  const rows = useMemo(() => (feed.data ?? []).filter((t) => t.url !== latestClass?.url).slice(0, 8), [feed.data, latestClass]);

  return (
    <Screen className="home">
      <div className="pull" style={{ height: ps.height, opacity: ps.opacity }} aria-hidden="true">{ps.label}</div>
      {drawer ? <TodayCard verse={verse.data} failed={verse.isError} /> : <>
      <div className="hello">
        <img src={assetUrl("brand/cyber-lion.webp")} alt="" width={44} height={44} onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
        <div><p>{user?.first_name ? `Shalom, ${user.first_name}` : "Shalom"}</p><h1>What do you want to learn?</h1></div>
      </div>
      <TodayCard verse={verse.data} failed={verse.isError} />
      <SearchHero value={q} onChange={setQ} onSubmit={search} big />
      <div className="door">
        <button type="button" className="btn btn--bordered door__btn" onClick={() => { if (q.trim()) search(q); else document.getElementById("q")?.focus(); }}><Icon name="search" size={18} /> Search</button>
        <button type="button" className="btn btn--bordered door__btn door__btn--ask" onClick={() => { haptic("select"); navigate(q.trim() ? `/ask?q=${encodeURIComponent(q.trim())}` : "/ask"); }}><Icon name="note" size={18} /> Ask CyberJudah</button>
      </div>
      <p className="hint hint--center">Search finds the moment a word, a name or a Scripture was said in a class. Ask answers your question from the teachings, with its sources.</p>
      </>}
      <StudyStats expanded={drawer} active={active} />
      {!drawer ? <>
      {whatsNew.length ? (
        <div className="whatsnew" aria-label="New in CyberJudah">
          {whatsNew.slice(0, 8).map((w) => (
            <Link key={`${w.kind}:${w.url}`} to={toApp(w.url)} className="whatsnew__card" data-kind={w.kind} onClick={() => haptic("select")}>
              <small>{w.kind === "pass" ? "New precept pass" : w.kind === "book" ? "New in the library" : w.kind === "captains" ? "New from the Captains" : "New class"}</small>
              <b>{w.title}</b>
              <span>{[w.sub, fmtDate(w.date)].filter(Boolean).join(" · ")}</span>
            </Link>
          ))}
        </div>
      ) : null}

      {live.data?.live && live.data.video ? (
        <Link to={`/watch/${encodeURIComponent(live.data.video)}?live=1`} className="live-card">
          <span className="live-card__dot" aria-hidden="true" />
          <span><small>Live now</small><b>{live.data.title || "Sabbath class"}</b></span>
          <Icon name="play" size={20} />
        </Link>
      ) : live.data?.upcoming && live.data.video && live.data.starts && new Date(live.data.starts).getTime() - Date.now() > -15 * 60_000 && new Date(live.data.starts).getTime() - Date.now() < 6 * 3600_000 ? (
        <Link to={`/watch/${encodeURIComponent(live.data.video)}?live=1`} className="live-card live-card--soon">
          <span className="live-card__dot" aria-hidden="true" />
          <span><small>Starting {new Date(live.data.starts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</small><b>{live.data.title || "Sabbath class"}</b></span>
          <Icon name="play" size={20} />
        </Link>
      ) : null}

      {(lastNote || last) ? (
        <div className="resume">
          {lastNote ? <Link to={lastNote.href} className="resume__item"><span className="resume__icon"><Icon name="play" size={18} /></span><span><small>Continue watching</small><b>{lastNote.title}</b></span></Link> : null}
          {last ? <Link to={`/read/${last.slug}/${last.chapter}`} className="resume__item"><span className="resume__icon"><Icon name="book" size={18} /></span><span><small>Continue reading{lastBook ? ` · ${lastRead} of ${lastBook.chapters} chapters` : ""}</small><b>{last.name}</b>{lastBook ? <span className="resume__bar"><i style={{ width: `${Math.round((lastRead / Math.max(1, lastBook.chapters)) * 100)}%` }} /></span> : null}</span></Link> : null}
        </div>
      ) : null}

      </> : null}
      <h2 className="shelf">Learn</h2>
      {feed.isPending ? <Skeleton rows={1} thumb /> : latestClass ? (
        <Link to={teachingTo(latestClass)} className="feature">
          <span className="feature__img"><Img src={latestClass.thumb} eager /></span>
          <span className="feature__body"><small>{[weekLabel(latestClass.date), fmtDate(latestClass.date), latestClass.teacher].filter(Boolean).join(" · ")}{latestClass.pending ? <span className="soon">Notes coming soon</span> : null}</small><b>{latestClass.title}</b>{latestClass.books.length ? <span className="feed__books">{latestClass.books.slice(0, 4).map((b) => <em key={b}>{b}</em>)}</span> : null}</span>
        </Link>
      ) : null}
      <div className="shelf-grid">
        {LEARN.map(([to, title, sub, icon]) => <Link key={to} to={to} className="shelf-card" onClick={() => haptic("select")}><span className="shelf-card__icon"><Icon name={icon} size={20} /></span><b>{title}</b><span>{sub}</span></Link>)}
      </div>
      <div className="shelf-grid">
        {LAW.map(([to, title, sub, icon]) => <Link key={to} to={to} className="shelf-card shelf-card--law" onClick={() => haptic("select")}><span className="shelf-card__icon"><Icon name={icon} size={20} /></span><b>{title}</b><span>{sub}</span></Link>)}
      </div>

      <h2 className="shelf">Study</h2>
      <div className="widgets" aria-label="Of the day">
        <StrongOfTheDay lang="greek" />
        <StrongOfTheDay lang="hebrew" />
        <TopicOfTheDay />
        <WordOfTheDay />
        <PersonOfTheDay />
        <PreceptOfTheDay />
      </div>
      <div className="tools">
        {TOOLS.map(([to, title, icon]) => <Link key={to} to={to} className="tools__btn" onClick={() => haptic("select")}><Icon name={icon} size={20} /><span>{title}</span></Link>)}
        <button type="button" className="tools__btn" onClick={() => void random()}><Icon name="retry" size={20} /><span>Random verse</span></button>
      </div>

      <h2 className="shelf">Meditate</h2>
      {sched && today && plan ? (
        <Link to="/plan" className="streak" onClick={() => haptic("select")}>
          <span className="streak__day"><b>Day {plan.day + 1}</b><small>{sched.owed ? `${sched.owed} to catch up` : `${today.pct}% of this plan`}</small></span>
          <span className="streak__bar"><i style={{ width: `${Math.round((todayRead / Math.max(1, today.chapters.length)) * 100)}%` }} /></span>
          <span className="streak__due">{todayRead}/{today.chapters.length} today</span>
          {plan.streak ? <span className="streak__fire">🔥 {plan.streak}</span> : null}
        </Link>
      ) : (
        <Card href="/plan" className="plan-start"><span className="resume__icon"><Icon name="check" /></span><span><b>Start a reading plan</b><span>The whole library, a few chapters a day, at your pace</span></span><Icon name="chevron" size={18} /></Card>
      )}
      <Card href="/study" className="plan-start"><span className="resume__icon"><Icon name="book" /></span><span><b>4 Chapters a Day</b><span>The daily reading, a note for every chapter</span></span><Icon name="chevron" size={18} /></Card>
      {sab ? <Card href="/sabbath" className="sabbath"><span className="sabbath__icon"><Icon name="sun" /></span><span><b>{sab.sabbath ? "Shabbat shalom" : `Sabbath in ${countdown(sab.next, now)}`}</b><span>{sab.label} · {sab.next.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span></span></Card> : <Card href="/sabbath" className="sabbath"><span className="sabbath__icon"><Icon name="sun" /></span><span><b>Sabbath</b><span>Sunset where you are, and the countdown</span></span></Card>}

      <Section title="Latest Teachings" action={<Link to="/classes">All classes</Link>}>
        <div className="feed">
          {rows.map((t) => (
            <Link key={t.url} to={teachingTo(t)} className="feed__card">
              <span className="feed__img"><Img src={t.thumb} /><span className="feed__kind">{teachingLabel(t)}</span></span>
              <span className="feed__body"><b>{t.title}</b><small>{[t.sub, fmtDate(t.date), t.teacher].filter(Boolean).join(" · ")}{t.pending ? <span className="soon">Notes coming soon</span> : null}</small></span>
            </Link>
          ))}
        </div>
      </Section>

      <h2 className="shelf">Go further</h2>
      <div className="door">
        <Link to="/more" className="btn btn--bordered door__btn" onClick={() => haptic("select")}><Icon name="more" size={18} /> Everything else</Link>
        <button type="button" className="btn btn--bordered door__btn" onClick={() => void share({ kind: "app", title: "CyberJudah", text: "The KJV with the Apocrypha, and everything taught from it, in Telegram.", sitePath: "/" })}><Icon name="share" size={18} /> Share the app</button>
      </div>
    </Screen>
  );
}
