import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";

import { data, fmtDate, type FeedRow, type HistoryRow } from "@/api/data";
import { useLast, useLastNote } from "@/lib/marks";
import { countdown, sabbath } from "@/lib/sun";
import { useBackButton, useBottomButtons, useStored } from "@/tg/hooks";
import { haptic, user } from "@/tg/sdk";
import { Card, Icon, Img, Screen, Section, Skeleton } from "@/ui/ui";
import { SearchHero } from "@/ui/search-hero";

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
 * Home is the front door: the search of what was said in the classes, Ask CyberJudah, then
 * where you left off, this week's class and the latest teachings.
 */
export function Home() {
  const navigate = useNavigate();
  useBackButton(true);
  const [q, setQ] = useState("");
  const [last] = useLast();
  const [lastNote] = useLastNote();
  const [loc] = useStored<{ lat: number; lng: number } | null>("loc", null);
  const verse = useQuery({ queryKey: ["votd"], queryFn: () => fetch("/api/verse-of-day").then((r) => r.json() as Promise<Verse>), staleTime: 60 * 60_000 });
  const feed = useTeachings();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(t); }, []);
  const sab = loc ? sabbath(now, loc.lat, loc.lng) : null;
  const search = (text: string) => { const t = text.trim(); if (t) navigate(`/search?q=${encodeURIComponent(t)}`); };
  useBottomButtons(null, null);

  const latestClass = feed.data?.find((t) => t.kind === "class");
  const rows = useMemo(() => (feed.data ?? []).filter((t) => t.url !== latestClass?.url).slice(0, 8), [feed.data, latestClass]);

  return (
    <Screen className="home">
      <div className="hello">
        <img src="https://cyberjudah.io/assets/brand/cyber-lion.png" alt="" width={44} height={44} />
        <div><p>{user?.first_name ? `Shalom, ${user.first_name}` : "Shalom"}</p><h1>What do you want to learn?</h1></div>
      </div>
      <SearchHero value={q} onChange={setQ} onSubmit={search} big />
      <div className="door">
        <button type="button" className="door__btn" onClick={() => search(q)} disabled={!q.trim()}><Icon name="search" size={18} /> Search</button>
        <button type="button" className="door__btn door__btn--ask" onClick={() => { haptic("select"); navigate(q.trim() ? `/ask?q=${encodeURIComponent(q.trim())}` : "/ask"); }}><Icon name="note" size={18} /> Ask CyberJudah</button>
      </div>
      <p className="hint hint--center">Search finds the moment a word, a name or a Scripture was said in a class. Ask answers your question from the teachings, with its sources.</p>

      {(lastNote || last) ? (
        <div className="resume">
          {lastNote ? <Link to={lastNote.href} className="resume__item"><span className="resume__icon"><Icon name="play" size={18} /></span><span><small>Continue watching</small><b>{lastNote.title}</b></span></Link> : null}
          {last ? <Link to={`/read/${last.slug}/${last.chapter}`} className="resume__item"><span className="resume__icon"><Icon name="book" size={18} /></span><span><small>Continue reading</small><b>{last.name}</b></span></Link> : null}
        </div>
      ) : null}

      {sab ? <Card href="/sabbath" className="sabbath"><span className="sabbath__icon"><Icon name="sun" /></span><span><b>{sab.sabbath ? "Shabbat shalom" : `Sabbath in ${countdown(sab.next, now)}`}</b><span>{sab.label} · {sab.next.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span></span></Card> : null}

      {feed.isPending ? <Skeleton rows={3} thumb /> : latestClass ? (
        <Section title="This week's class">
          <Link to={`/note${latestClass.url}`} className="feature">
            <span className="feature__img"><Img src={latestClass.thumb} eager /><span className="feature__play"><Icon name="play" size={22} /></span></span>
            <span className="feature__body"><small>{[fmtDate(latestClass.date), latestClass.teacher].filter(Boolean).join(" · ")}</small><b>{latestClass.title}</b>{latestClass.books.length ? <span className="feed__books">{latestClass.books.slice(0, 4).map((b) => <em key={b}>{b}</em>)}</span> : null}</span>
          </Link>
        </Section>
      ) : null}

      <Section title="Latest teachings" action={<Link to="/classes">All classes</Link>}>
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
