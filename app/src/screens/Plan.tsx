import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";

import { data } from "@/api/data";
import { chaptersRead, dayKey, markRead, usePlan, useProgress } from "@/lib/marks";
import { advance, dateOfDay, planDay, realign, schedule, startPlan } from "@/lib/plan";
import { useBackButton, useBottomButtons } from "@/tg/hooks";
import { confirm, haptic } from "@/tg/sdk";
import { useSheet } from "@/ui/sheet";
import { Card, Empty, Screen, Section, Skeleton } from "@/ui/ui";

/**
 * The reading plan: the whole library in order, a few chapters a day, with today's chapters
 * to tick off, the streak and how far along the reader is. Reading a chapter in the app
 * ticks it; a tap here does too, for chapters read elsewhere. A strip of days along the top
 * shows each day's reading against the calendar, and when the reader falls behind, a chip
 * offers to catch up or to move the schedule to today.
 */
export function Plan() {
  useBackButton(false);
  const sheet = useSheet();
  const books = useQuery({ queryKey: ["books"], queryFn: data.books, staleTime: Infinity });
  const [plan, setPlan] = usePlan();
  const [progress, setProgress] = useProgress();
  const today = plan && books.data ? planDay(plan, books.data, progress) : null;
  const [viewDay, setViewDay] = useState<number | null>(null);
  const shown = plan && books.data && viewDay !== null && viewDay !== plan.day ? planDay(plan, books.data, progress, viewDay) : today;
  const sched = plan && books.data ? schedule(plan, books.data, progress) : null;
  const tick = (slug: string, ch: number) => { haptic("success"); setProgress(markRead(progress, slug, ch)); };
  const catchUp = async () => {
    if (!plan || !today || !sched) return;
    const next = today.chapters.find((c) => !c.read);
    const a = await sheet.open({ title: `${sched.offset} ${sched.offset === 1 ? "day" : "days"} behind`, items: [
      ...(next ? [{ id: "read", text: `Read ${next.book} ${next.chapter}`, hint: `${sched.owed} ${sched.owed === 1 ? "chapter" : "chapters"} to catch up` }] : []),
      { id: "realign", text: "Start the schedule from today", hint: `Day ${plan.day + 1} becomes today; nothing read is lost` },
    ] });
    if (a?.id === "read" && next) location.assign(`/read/${next.slug}/${next.chapter}`);
    if (a?.id === "realign") { setPlan(realign(plan)); haptic("success"); }
  };

  const start = async () => {
    const a = await sheet.open({ title: "How much a day?", items: [{ id: "4", text: "4 chapters a day", hint: "The class's pace · about 11 months" }, { id: "2", text: "2 chapters a day", hint: "About 22 months" }, { id: "6", text: "6 chapters a day", hint: "About 7 months" }] });
    if (a) { setPlan(startPlan(+a.id)); haptic("success"); }
  };
  const reset = async () => { if (await confirm("Start the plan over from Genesis 1? Your reading progress stays.")) setPlan(null); };
  useBottomButtons(plan ? (today?.done ? { text: "Tomorrow's reading", onClick: () => setPlan(advance(plan)) } : today?.chapters.find((c) => !c.read) ? { text: `Read ${today.chapters.find((c) => !c.read)!.book} ${today.chapters.find((c) => !c.read)!.chapter}`, onClick: () => { const c = today!.chapters.find((x) => !x.read)!; location.assign(`/read/${c.slug}/${c.chapter}`); } } : null) : null, plan ? { text: "Start over", onClick: () => void reset() } : null);

  if (books.isPending) return <Screen title="Reading plan"><Skeleton rows={4} /></Screen>;
  if (!plan || !today) return (
    <Screen title="Reading plan" kicker="4 Chapters a Day">
      {/* Before a plan is started there is little on the page, so its one action sits with the words it answers. */}
      <Empty title="Read the whole library, a few chapters a day" action={{ label: "Start the plan", onClick: () => void start() }}>Genesis to Revelation with the Apocrypha, in order. The app ticks off each chapter as you read it and keeps your streak.</Empty>
      <Card><p className="card__label">So far</p><p className="verse" style={{ fontFamily: "var(--font-ui)", fontWeight: 700 }}>{chaptersRead(progress)} chapters read</p></Card>
    </Screen>
  );
  const dayDone = shown!.done;
  return (
    <Screen title="Reading plan" kicker={`Day ${today.day + 1} of ${today.total}`}>
      <Card glow>
        <p className="card__label">{today.done ? "Today · done" : "Today"}</p>
        <p className="verse" style={{ fontFamily: "var(--font-ui)", fontWeight: 700, fontSize: 26, letterSpacing: "-0.02em" }}>{today.label}</p>
        <div className="progress" style={{ marginTop: 12 }}><i style={{ width: `${today.pct}%` }} /></div>
        <p className="card__ref">{today.pct}% of the library · {plan.streak} day streak{plan.streak >= 7 ? " 🔥" : ""}{sched && sched.offset < 0 ? ` · ${-sched.offset} ${sched.offset === -1 ? "day" : "days"} ahead` : ""}</p>
        {sched && sched.offset > 0 ? <button type="button" className="catchup" onClick={() => void catchUp()}>Catch up · {sched.owed} {sched.owed === 1 ? "chapter" : "chapters"}</button> : null}
      </Card>
      <DayStrip plan={plan} total={today.total} due={sched?.due ?? plan.day} selected={shown!.day} onSelect={(d) => { haptic("select"); setViewDay(d); }} />
      <Section title={shown!.day === plan.day ? "Chapters" : `Day ${shown!.day + 1} · ${dateOfDay(plan, shown!.day).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}`}>
        <div className="plan-day" data-done={dayDone ? "" : undefined}>
          {shown!.chapters.map((c) => (
            <Link key={`${c.slug}${c.chapter}`} to={`/read/${c.slug}/${c.chapter}`} className="plan-row" data-read={c.read ? "" : undefined}>
              <i onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (!c.read) tick(c.slug, c.chapter); }}>{c.read ? "✓" : ""}</i>
              {c.book} {c.chapter}
            </Link>
          ))}
        </div>
        {dayDone && shown!.day === plan.day ? <p className="plan-done" role="status">🎉 Day {plan.day + 1} done. Well read.</p> : <p className="hint">Tap the circle to tick a chapter you read elsewhere.</p>}
      </Section>
      <div className="stat">
        <div><b>{plan.streak}</b><span>streak</span></div>
        <div><b>{chaptersRead(progress)}</b><span>read</span></div>
        <div><b>{today.total - today.day}</b><span>days left</span></div>
      </div>
    </Screen>
  );
}

/** The days around where the reader is: done days ticked, the calendar's today ringed, one selected. */
function DayStrip({ plan, total, due, selected, onSelect }: { plan: NonNullable<ReturnType<typeof usePlan>[0]>; total: number; due: number; selected: number; onSelect: (d: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const from = Math.max(0, Math.min(plan.day, due) - 7), to = Math.min(total - 1, Math.max(plan.day, due) + 14);
  useEffect(() => { ref.current?.querySelector<HTMLElement>("[aria-current]")?.scrollIntoView({ inline: "center", block: "nearest" }); }, [plan.day]);
  const todayKey = dayKey();
  return (
    <div className="daystrip" ref={ref} role="tablist" aria-label="Days">
      {Array.from({ length: to - from + 1 }, (_, i) => from + i).map((d) => {
        const date = dateOfDay(plan, d);
        return (
          <button key={d} type="button" role="tab" className="daystrip__day" aria-selected={d === selected} aria-current={d === plan.day ? "step" : undefined}
            data-done={d < plan.day ? "" : undefined} data-today={dayKey(date) === todayKey ? "" : undefined} data-late={d < due && d >= plan.day ? "" : undefined} onClick={() => onSelect(d)}>
            <small>{date.toLocaleDateString([], { weekday: "narrow" })}</small>
            <b>{d < plan.day ? "✓" : date.getDate()}</b>
          </button>
        );
      })}
    </div>
  );
}
