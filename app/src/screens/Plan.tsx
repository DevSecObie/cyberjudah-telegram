import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";

import { data } from "@/api/data";
import { chaptersRead, markRead, usePlan, useProgress } from "@/lib/marks";
import { advance, planDay, startPlan } from "@/lib/plan";
import { useBackButton, useBottomButtons } from "@/tg/hooks";
import { confirm, haptic } from "@/tg/sdk";
import { useSheet } from "@/ui/sheet";
import { Card, Empty, Screen, Section, Skeleton } from "@/ui/ui";

/**
 * The reading plan: the whole library in order, a few chapters a day, with today's chapters
 * to tick off, the streak and how far along the reader is. Reading a chapter in the app
 * ticks it; a tap here does too, for chapters read elsewhere.
 */
export function Plan() {
  useBackButton(false);
  const sheet = useSheet();
  const books = useQuery({ queryKey: ["books"], queryFn: data.books, staleTime: Infinity });
  const [plan, setPlan] = usePlan();
  const [progress, setProgress] = useProgress();
  const today = plan && books.data ? planDay(plan, books.data, progress) : null;

  const start = async () => {
    const a = await sheet.open({ title: "How much a day?", items: [{ id: "4", text: "4 chapters a day", hint: "The class's pace · about 11 months" }, { id: "2", text: "2 chapters a day", hint: "About 22 months" }, { id: "6", text: "6 chapters a day", hint: "About 7 months" }] });
    if (a) { setPlan(startPlan(+a.id)); haptic("success"); }
  };
  const reset = async () => { if (await confirm("Start the plan over from Genesis 1? Your reading progress stays.")) setPlan(null); };
  useBottomButtons(plan ? (today?.done ? { text: "Tomorrow's reading", onClick: () => setPlan(advance(plan)) } : today?.chapters.find((c) => !c.read) ? { text: `Read ${today.chapters.find((c) => !c.read)!.book} ${today.chapters.find((c) => !c.read)!.chapter}`, onClick: () => { const c = today!.chapters.find((x) => !x.read)!; location.assign(`/read/${c.slug}/${c.chapter}`); } } : null) : { text: "Start the plan", onClick: () => void start() }, plan ? { text: "Start over", onClick: () => void reset() } : null);

  if (books.isPending) return <Screen title="Reading plan"><Skeleton rows={4} /></Screen>;
  if (!plan || !today) return (
    <Screen title="Reading plan" kicker="4 Chapters a Day">
      <Empty title="Read the whole library, a few chapters a day">Genesis to Revelation with the Apocrypha, in order. The app ticks off each chapter as you read it and keeps your streak.</Empty>
      <Card><p className="card__label">So far</p><p className="verse" style={{ fontFamily: "var(--a-ui)", fontWeight: 700 }}>{chaptersRead(progress)} chapters read</p></Card>
    </Screen>
  );
  return (
    <Screen title="Reading plan" kicker={`Day ${today.day + 1} of ${today.total}`}>
      <Card glow>
        <p className="card__label">Today</p>
        <p className="verse" style={{ fontFamily: "var(--a-ui)", fontWeight: 700, fontSize: 26, letterSpacing: "-0.02em" }}>{today.label}</p>
        <div className="progress" style={{ marginTop: 12 }}><i style={{ width: `${today.pct}%` }} /></div>
        <p className="card__ref">{today.pct}% of the library · {plan.streak} day streak{plan.streak >= 7 ? " 🔥" : ""}</p>
      </Card>
      <Section title="Chapters">
        <div className="plan-day">
          {today.chapters.map((c) => (
            <Link key={`${c.slug}${c.chapter}`} to={`/read/${c.slug}/${c.chapter}`} className="plan-row" data-read={c.read ? "" : undefined} onClick={(e) => { if (e.altKey) { e.preventDefault(); setProgress(markRead(progress, c.slug, c.chapter)); } }}>
              <i onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (!c.read) { haptic("success"); setProgress(markRead(progress, c.slug, c.chapter)); } }}>{c.read ? "✓" : ""}</i>
              {c.book} {c.chapter}
            </Link>
          ))}
        </div>
        <p className="hint">Tap the circle to tick a chapter you read elsewhere.</p>
      </Section>
      <div className="stat">
        <div><b>{plan.streak}</b><span>streak</span></div>
        <div><b>{chaptersRead(progress)}</b><span>read</span></div>
        <div><b>{today.total - today.day}</b><span>days left</span></div>
      </div>
    </Screen>
  );
}
