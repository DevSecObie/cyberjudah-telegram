import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router";

import { data, fmtDate, when } from "@/api/data";
import { useLast, useProgress, chaptersRead } from "@/lib/marks";
import { countdown, sabbath } from "@/lib/sun";
import { useBackButton, useBottomButtons, useStored } from "@/tg/hooks";
import { user } from "@/tg/sdk";
import { Card, Icon, Img, Screen, Section, Skeleton, useGo } from "@/ui/ui";

type Verse = { ref: string; slug: string; chapter: number; verse: number; text: string };

const SHORTCUTS: [string, string, string][] = [
  ["/classes?feed=classes", "Sabbath Classes", "watch"], ["/classes?feed=captains", "15 Min w/ Captains", "watch"], ["/classes?feed=history", "Hidden History", "listen"],
  ["/law", "The Law", "handbook"], ["/precepts", "Precepts", "a–z"], ["/study", "4 Chapters a Day", "daily"],
];

export function Home() {
  const go = useGo();
  useBackButton(true);
  const [last] = useLast();
  const [progress] = useProgress();
  const [loc] = useStored<{ lat: number; lng: number } | null>("loc", null);
  const verse = useQuery({ queryKey: ["votd"], queryFn: () => fetch("/api/verse-of-day").then((r) => r.json() as Promise<Verse>), staleTime: 60 * 60_000 });
  const classes = useQuery({ queryKey: ["classes"], queryFn: data.classes });
  const captains = useQuery({ queryKey: ["captains"], queryFn: data.captains });
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(t); }, []);
  const sab = loc ? sabbath(now, loc.lat, loc.lng) : null;
  const read = chaptersRead(progress);

  useBottomButtons(
    last ? { text: `Continue · ${last.name}`, onClick: () => go(`/bible/${last.slug}/${last.chapter}`) } : { text: "Open the Bible", onClick: () => go("/bible") },
    { text: "Search", onClick: () => go("/search") },
  );
  const latest = <T extends { date: string }>(rows?: T[]) => [...(rows ?? [])].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);

  return (
    <Screen>
      <div className="hello">
        <img src="/icon.png" alt="" width={44} height={44} />
        <div><p>{user?.first_name ? `Shalom, ${user.first_name}` : "Shalom"}</p><h1>CyberJudah</h1></div>
      </div>

      <button type="button" className="field field--button" onClick={() => go("/search")}><Icon name="search" size={18} /><span>Search scripture, classes, law…</span></button>

      {sab ? (
        <Card href="/sabbath" className="sabbath">
          <span className="sabbath__icon"><Icon name="sun" /></span>
          <span><b>{sab.sabbath ? "Shabbat shalom" : `Sabbath in ${countdown(sab.next, now)}`}</b><span>{sab.label} · {sab.next.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span></span>
        </Card>
      ) : null}

      {last ? (
        <Card href={`/bible/${last.slug}/${last.chapter}`} className="continue">
          <span className="continue__icon"><Icon name="book" /></span>
          <span><b>Continue reading</b><span>{last.name}{read ? ` · ${read} chapters read` : ""}</span></span>
        </Card>
      ) : null}

      <Card glow href={verse.data ? `/bible/${verse.data.slug}/${verse.data.chapter}?v=${verse.data.verse}` : "/bible"}>
        <p className="card__label">Today's passage</p>
        {verse.data ? <><p className="verse">{verse.data.text}</p><p className="card__ref">{verse.data.ref}</p></> : <p className="verse" style={{ opacity: 0.5 }}>Loading the day's verse…</p>}
      </Card>

      <Section title="Latest classes" action={<Link to="/classes?feed=classes">See all</Link>}>
        {classes.isPending ? <Skeleton rows={2} thumb /> : (
          <div className="rail">
            {latest(classes.data).map((c) => <Link key={c.url} className="tile" to={`/note${c.url}`}><span className="tile__img">{c.thumb ? <Img src={c.thumb} /> : null}</span><b>{c.title}</b><span>{when(c.date, c.teacher)}</span></Link>)}
          </div>
        )}
      </Section>

      <Section title="Explore">
        <div className="grid">{SHORTCUTS.map(([to, label, tag]) => <Link key={to} to={to}><b>{label}</b><span>{tag}</span></Link>)}</div>
      </Section>

      <Section title="15 Minutes w/ The Captains" action={<Link to="/classes?feed=captains">See all</Link>}>
        {captains.isPending ? <Skeleton rows={2} thumb /> : (
          <div className="rail">
            {latest(captains.data).map((c) => <Link key={c.url} className="tile" to={`/note${c.url}`}><span className="tile__img">{c.thumb ? <Img src={c.thumb} /> : null}</span><b>{c.title}</b><span>{fmtDate(c.date)}</span></Link>)}
          </div>
        )}
      </Section>
    </Screen>
  );
}
