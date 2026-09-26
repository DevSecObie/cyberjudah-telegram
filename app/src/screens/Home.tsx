import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";

import { data, fmtDate, type FeedRow, type HistoryRow } from "@/api/data";
import { useLast, useLastNote, usePlan, useProgress } from "@/lib/marks";
import { planDay } from "@/lib/plan";
import { countdown, sabbath } from "@/lib/sun";
import { useBackButton, useBottomButtons, useStored } from "@/tg/hooks";
import { user } from "@/tg/sdk";
import { Card, Chip, Chips, Icon, Img, Screen, Section, Segmented, Skeleton, useGo } from "@/ui/ui";
import { ASK_PROMPTS, LiveResults, SearchHero } from "@/ui/search-hero";
import { referencePath } from "./Search";

type Verse = { ref: string; slug: string; chapter: number; verse: number; text: string };
export type Teaching = { kind: "class" | "captains" | "history"; url: string; title: string; date: string; teacher: string; thumb: string; topics: string[]; books: string[]; sub?: string; collection?: string };
export const KIND_NAME: Record<Teaching["kind"], string> = { class: "Sabbath class", captains: "15 Min w/ Captains", history: "Our Hidden History" };

/** Everything taught, newest first, in one feed. */
export function useTeachings() {
  return useQuery({
    queryKey: ["teachings"],
    queryFn: async (): Promise<Teaching[]> => {
      const [classes, captains, history] = await Promise.all([data.classes(), data.captains(), data.history().catch(() => [] as HistoryRow[])]);
      const row = (kind: Teaching["kind"]) => (r: FeedRow): Teaching => ({ kind, url: r.url, title: r.title, date: r.date, teacher: r.teacher, thumb: r.thumb, topics: r.topics ?? [], books: r.books ?? [], collection: r.collection });
      const hist = history.map<Teaching>((r) => ({ kind: "history", url: r.url, title: r.title, date: r.date ?? "", teacher: r.teacher, thumb: r.thumb, topics: r.topics, books: [], sub: r.episode ? `Episode ${r.episode}` : undefined }));
      return [...classes.map(row("class")), ...captains.map(row("captains")), ...hist].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    },
    staleTime: 10 * 60_000,
  });
}

/**
 * Home is the front door: one field that searches the teachings by their words or asks
 * CyberJudah a question, the way the reader chooses; then where you left off, this
 * week's class, and the feed of everything taught, with the topics as filters.
 */
export function Home() {
  const go = useGo();
  const navigate = useNavigate();
  useBackButton(true);
  const [q, setQ] = useState("");
  const [door, setDoor] = useStored<"search" | "ask">("door", "search");
  const [last] = useLast();
  const [lastNote] = useLastNote();
  const [progress] = useProgress();
  const [plan] = usePlan();
  const books = useQuery({ queryKey: ["books"], queryFn: data.books, staleTime: Infinity });
  const today = plan && books.data ? planDay(plan, books.data, progress) : null;
  const [loc] = useStored<{ lat: number; lng: number } | null>("loc", null);
  const verse = useQuery({ queryKey: ["votd"], queryFn: () => fetch("/api/verse-of-day").then((r) => r.json() as Promise<Verse>), staleTime: 60 * 60_000 });
  const feed = useTeachings();
  const [topic, setTopic] = useState("");
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(t); }, []);
  const sab = loc ? sabbath(now, loc.lat, loc.lng) : null;
  const ask = (text: string) => { const t = text.trim(); if (t) navigate(`/ask?q=${encodeURIComponent(t)}`); };
  const search = (text: string) => { const t = text.trim(); if (!t) return; const ref = referencePath(t); if (ref) { go(ref); return; } navigate(`/search?q=${encodeURIComponent(t)}`); };
  const submit = door === "ask" ? ask : search;
  useBottomButtons(null, null);

  const latestClass = feed.data?.find((t) => t.kind === "class");
  const topics = useMemo(() => { const n = new Map<string, number>(); for (const t of feed.data ?? []) for (const x of t.topics) n.set(x, (n.get(x) ?? 0) + 1); return [...n].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([t]) => t); }, [feed.data]);
  const rows = useMemo(() => (feed.data ?? []).filter((t) => t.url !== latestClass?.url && (!topic || t.topics.includes(topic))).slice(0, 24), [feed.data, topic, latestClass]);

  return (
    <Screen className="home">
      <div className="hello">
        <img src="https://cyberjudah.io/assets/brand/cyber-lion.png" alt="" width={44} height={44} />
        <div><p>{user?.first_name ? `Shalom, ${user.first_name}` : "Shalom"}</p><h1>What do you want to learn?</h1></div>
      </div>
      <Segmented label="Search or ask" value={door} onChange={setDoor} options={[["search", "Search the teachings"], ["ask", "Ask CyberJudah"]]} />
      <SearchHero value={q} onChange={setQ} onSubmit={submit} mode={door} big>
        {door === "ask" ? (
          <div className="door">
            <p className="hint">Ask anything about what was taught. The answer is drawn from the classes, the Captains, the notes, the law and the Scripture, with its sources.</p>
            <Chips>{ASK_PROMPTS.map((e) => <Chip key={e} onClick={() => ask(e)}>{e}</Chip>)}</Chips>
          </div>
        ) : <LiveResults q={q} onAll={search} onSpoken={(t) => navigate(`/search?q=${encodeURIComponent(t)}&in=recordings`)} onAsk={ask} />}
      </SearchHero>

      {(lastNote || last) ? (
        <div className="resume">
          {lastNote ? <Link to={lastNote.href} className="resume__item"><span className="resume__icon"><Icon name="play" size={18} /></span><span><small>Continue watching</small><b>{lastNote.title}</b></span></Link> : null}
          {last ? <Link to={`/read/${last.slug}/${last.chapter}`} className="resume__item"><span className="resume__icon"><Icon name="book" size={18} /></span><span><small>Continue reading</small><b>{last.name}</b></span></Link> : null}
        </div>
      ) : null}

      {sab ? <Card href="/sabbath" className="sabbath"><span className="sabbath__icon"><Icon name="sun" /></span><span><b>{sab.sabbath ? "Shabbat shalom" : `Sabbath in ${countdown(sab.next, now)}`}</b><span>{sab.label} · {sab.next.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span></span></Card> : null}
      {today && !today.done ? <Card href="/plan" className="continue"><span className="continue__icon"><Icon name="check" /></span><span><b>Today's reading · {today.label}</b><span>{today.chapters.filter((c) => c.read).length} of {today.chapters.length} read{plan!.streak ? ` · ${plan!.streak} day streak` : ""}</span></span></Card> : null}

      {feed.isPending ? <Skeleton rows={3} thumb /> : latestClass ? (
        <Section title="This week's class">
          <Link to={`/note${latestClass.url}`} className="feature">
            <span className="feature__img"><Img src={latestClass.thumb} eager /><span className="feature__play"><Icon name="play" size={22} /></span></span>
            <span className="feature__body"><small>{[fmtDate(latestClass.date), latestClass.teacher].filter(Boolean).join(" · ")}</small><b>{latestClass.title}</b>{latestClass.books.length ? <span className="feed__books">{latestClass.books.slice(0, 4).map((b) => <em key={b}>{b}</em>)}</span> : null}</span>
          </Link>
        </Section>
      ) : null}

      <Section title="The teachings" action={<Link to="/classes">All classes</Link>}>
        {topics.length ? <Chips><Chip on={!topic} onClick={() => setTopic("")}>Latest</Chip>{topics.map((t) => <Chip key={t} on={topic === t} onClick={() => setTopic(topic === t ? "" : t)}>{t}</Chip>)}</Chips> : null}
        <div className="feed">
          {rows.map((t) => (
            <Link key={t.url} to={`/note${t.url}`} className="feed__card">
              <span className="feed__img"><Img src={t.thumb} /><span className="feed__kind">{KIND_NAME[t.kind]}</span></span>
              <span className="feed__body"><b>{t.title}</b><small>{[t.sub, fmtDate(t.date), t.teacher].filter(Boolean).join(" · ")}</small></span>
            </Link>
          ))}
        </div>
      </Section>

      <Card glow href={verse.data ? `/read/${verse.data.slug}/${verse.data.chapter}?v=${verse.data.verse}` : "/bible"}>
        <p className="card__label">Today's Scripture</p>
        {verse.data ? <><p className="verse">{verse.data.text}</p><p className="card__ref">{verse.data.ref}</p></> : <p className="verse" style={{ opacity: 0.5 }}>Loading the day's verse…</p>}
      </Card>
    </Screen>
  );
}
