import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";

import { data, fmtDate, type FeedRow, type HistoryRow, type Opened } from "@/api/data";
import { orderTeachings } from "@shared/teaching-order.mjs";
import { pullStyle, usePullToRefresh } from "@/lib/pull";
import { planDay, schedule } from "@/lib/plan";
import { share } from "@/lib/share";
import { usePlan, useProgress } from "@/lib/marks";
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
    const all = orderTeachings([...notes.data, ...extra], broadcasts.data, undefined, (recent.data?.videos ?? []).map((v) => v.video));
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
  ["/topics", "Topics", "Classes and episodes by subject", "tag"],
];
/** The Study shelf: the reference works, each browsable on its own. */
const TOOLS: [string, string, IconName][] = [
  ["/lexicon", "Lexicon", "spark"], ["/dictionary", "Dictionary", "type"], ["/people", "People", "star"], ["/relations", "Your precepts", "precepts"], ["/bookmarks", "Kept", "bookmark"], ["/tags", "Tags", "tag"],
];

/** The welcome page offers Search and Ask; the dashboard lives in the Home drawer. */
export function Home() {
  useBackButton();
  useBottomButtons(null, null);
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [question, setQuestion] = useState("");
  const open = (path: "search" | "ask", value: string) => {
    const q = value.trim();
    if (q) { haptic("select"); navigate(`/${path}?q=${encodeURIComponent(q)}`); }
  };
  return (
    <Screen className="welcome">
      <div className="hello">
        <img src={assetUrl("brand/cyber-lion.webp")} alt="" width={38} height={38} />
        <div><p>{user?.first_name ? `Shalom, ${user.first_name}` : "Shalom"}</p><b>CyberJudah</b></div>
      </div>
      <div className="welcome__intro">
        <h1>What do you<br />want to learn?</h1>
        <p>A question or a passage. Start here.</p>
      </div>
      <section className="welcome__panel surface" aria-labelledby="welcome-search">
        <h2 id="welcome-search"><Icon name="search" size={24} /> Search</h2>
        <p>Find where it was taught.</p>
        <SearchHero value={search} onChange={setSearch} onSubmit={(q) => open("search", q)} placeholder="A word, name or Scripture">
          <button type="submit" className="welcome__action" disabled={!search.trim()}>Search the teachings<Icon name="arrowUp" size={20} /></button>
        </SearchHero>
      </section>
      <section className="welcome__panel surface" aria-labelledby="welcome-ask">
        <h2 id="welcome-ask"><Icon name="chat" size={24} /> Ask CyberJudah</h2>
        <p>Ask a question. See its sources.</p>
        <SearchHero id="welcome-question" mode="ask" value={question} onChange={setQuestion} onSubmit={(q) => open("ask", q)} placeholder="What would you like to know?">
          <button type="submit" className="welcome__action" disabled={!question.trim()}>Ask your question<Icon name="arrowUp" size={20} /></button>
        </SearchHero>
      </section>
    </Screen>
  );
}

/**
 * In Bible Strong's Events place at the top of Home: the class on the air now, or the next one
 * within six hours (and for 15 minutes after its start, while it may still be starting).
 */
function LiveBanner({ active }: { active: boolean }) {
  const live = useLive(active);
  const l = live.data;
  if (!l?.video) return null;
  const to = `/watch/${encodeURIComponent(l.video)}?live=1`;
  if (l.live) return (
    <Link to={to} className="live-card" onClick={() => haptic("select")}>
      <span className="live-card__dot" aria-hidden="true" />
      <span><small>Live now</small><b>{l.title || "Sabbath class"}</b></span>
      <Icon name="play" size={20} />
    </Link>
  );
  const wait = l.upcoming && l.starts ? new Date(l.starts).getTime() - Date.now() : NaN;
  if (!(wait > -15 * 60_000 && wait < 6 * 3600_000)) return null;
  return (
    <Link to={to} className="live-card live-card--soon" onClick={() => haptic("select")}>
      <span className="live-card__dot" aria-hidden="true" />
      <span><small>Starting {new Date(l.starts!).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</small><b>{l.title || "Sabbath class"}</b></span>
      <Icon name="play" size={20} />
    </Link>
  );
}

/** Bible Strong's OfflineNotice: a small pill while the device has no connection. */
function OfflinePill() {
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    addEventListener("online", on); addEventListener("offline", off);
    return () => { removeEventListener("online", on); removeEventListener("offline", off); };
  }, []);
  return online ? null : <p className="offline-pill" role="status"><Icon name="alert" size={14} /> You are offline</p>;
}

/** Bible Strong's Home drawer over the current tab. */
export function HomeBody({ drawer = false, active = true }: { drawer?: boolean; active?: boolean }) {
  const [plan] = usePlan();
  const [progress] = useProgress();
  const books = useQuery({ queryKey: ["books"], queryFn: data.books, staleTime: Infinity });
  const { pull, busy } = usePullToRefresh(active);
  const ps = pullStyle(pull, busy);
  const sched = plan && books.data ? schedule(plan, books.data, progress) : null;
  const today = plan && books.data ? planDay(plan, books.data, progress) : null;
  const todayRead = today ? today.chapters.filter((c) => c.read).length : 0;
  const [loc] = useStored<{ lat: number; lng: number } | null>("loc", null);
  const verse = useQuery({ queryKey: ["votd", new Date().toISOString().slice(0, 10)], queryFn: async () => { const r = await fetch("/api/verse-of-day"); if (!r.ok) throw new Error("Daily verse unavailable"); return r.json() as Promise<Verse>; }, staleTime: 60 * 60_000 });
  const feed = useTeachings();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(t); }, []);
  const sab = loc ? sabbath(now, loc.lat, loc.lng) : null;

  const random = useRandomVerse();
  const latestClass = feed.data?.find((t) => t.kind === "class");
  const rows = useMemo(() => (feed.data ?? []).filter((t) => t.url !== latestClass?.url).slice(0, 8), [feed.data, latestClass]);
  // In Bible Strong's Meditations place: the newest class series, to be followed part by part.
  const series = useMemo(() => {
    const newest = (feed.data ?? []).find((t) => t.series);
    if (!newest?.series) return null;
    return { name: newest.series.name, parts: (feed.data ?? []).filter((t) => t.series?.name === newest.series!.name).length };
  }, [feed.data]);

  return (
    <Screen className="home">
      <div className="pull" style={{ height: ps.height, opacity: ps.opacity }} aria-hidden="true">{ps.label}</div>
      <LiveBanner active={active} />
      <OfflinePill />
      <TodayCard verse={verse.data} failed={verse.isError} stacked={drawer} />
      <StudyStats expanded={drawer} active={active} />
      <h2 className="shelf">Learn</h2>
      {feed.isPending ? <Skeleton rows={1} thumb /> : latestClass ? (
        <Link to={teachingTo(latestClass)} className="feature">
          <span className="feature__img"><Img src={latestClass.thumb} eager /></span>
          <span className="feature__body"><small>{[weekLabel(latestClass.date), fmtDate(latestClass.date), latestClass.teacher].filter(Boolean).join(" · ")}{latestClass.pending ? <span className="soon">Notes coming soon</span> : null}</small><b>{latestClass.title}</b>{latestClass.books.length ? <span className="feed__books">{latestClass.books.slice(0, 4).map((b) => <em key={b}>{b}</em>)}</span> : null}</span>
        </Link>
      ) : null}
      {/* Bible Strong's pair of tall cards (The Bible Project's plan and the timeline): the daily
          reading in the plan's place, and the timeline. */}
      <div className="duo">
        <Link to="/study" className="duo__card duo__card--plan" onClick={() => haptic("select")}><Icon name="book" size={26} /><b>4 Chapters a Day</b><span>The daily reading, a note for every chapter</span></Link>
        <Link to="/timeline" className="duo__card duo__card--time" onClick={() => haptic("select")}><Icon name="clock" size={26} /><b>Bible timeline</b><span>Periods and events by year</span></Link>
      </div>
      <div className="shelf-grid">
        {LEARN.map(([to, title, sub, icon]) => <Link key={to} to={to} className="shelf-card" onClick={() => haptic("select")}><span className="shelf-card__icon"><Icon name={icon} size={20} /></span><b>{title}</b><span>{sub}</span></Link>)}
      </div>
      <div className="shelf-grid">
        {LAW.map(([to, title, sub, icon]) => <Link key={to} to={to} className="shelf-card shelf-card--law" onClick={() => haptic("select")}><span className="shelf-card__icon"><Icon name={icon} size={20} /></span><b>{title}</b><span>{sub}</span></Link>)}
      </div>

      <h2 className="shelf">Study</h2>
      <div className="widgets" aria-label="Of the day">
        <StrongOfTheDay lang="greek" compact={drawer} />
        <StrongOfTheDay lang="hebrew" compact={drawer} />
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
      <Link to="/plans" className="shelf-more" onClick={() => haptic("select")}>Explore reading plans<Icon name="chevron" size={16} /></Link>
      {series ? <Card href={`/classes?series=${encodeURIComponent(series.name)}`} className="plan-start"><span className="resume__icon"><Icon name="play" /></span><span><b>{series.name}</b><span>A class series · {series.parts} {series.parts === 1 ? "part" : "parts"}, in order</span></span><Icon name="chevron" size={18} /></Card> : null}
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
      {/* Bible Strong's DonationWidget. */}
      <Card href="/settings/donate" className="plan-start donate-card"><span className="resume__icon"><Icon name="star" /></span><span><b>Support CyberJudah</b><span>Keep the classes, notes and app free for everyone</span></span><Icon name="chevron" size={18} /></Card>
      <div className="door">
        <Link to="/settings/help" className="btn btn--bordered door__btn" onClick={() => haptic("select")}><Icon name="info" size={18} /> FAQ</Link>
        <Link to="/more" className="btn btn--bordered door__btn" onClick={() => haptic("select")}><Icon name="more" size={18} /> Everything else</Link>
        <button type="button" className="btn btn--bordered door__btn" onClick={() => void share({ kind: "app", title: "CyberJudah", text: "The KJV with the Apocrypha, and everything taught from it, in Telegram.", sitePath: "/" })}><Icon name="share" size={18} /> Share the app</button>
      </div>
    </Screen>
  );
}
