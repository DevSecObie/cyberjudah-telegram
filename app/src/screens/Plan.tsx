import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { data } from "@/api/data";
import { dayKey, markRead, unmarkRead, usePlan, useProgress } from "@/lib/marks";
import { advance, cataloguePlan, getPlanDayDate, getScheduledPlanDay, isCivilDate, PLAN_CATALOGUE, planCompletion, planDays } from "@/lib/plan";
import { useBackButton } from "@/tg/hooks";
import { haptic } from "@/tg/sdk";
import { Feather } from "@/bible/icons";
import { Button, Sheet } from "@/bible/ui/Sheet";
import { useSheet } from "@/ui/sheet";
import { Empty, Row, Screen, Skeleton } from "@/ui/ui";
import "./reading-plans.css";

/** 27.2.0 ScheduledPlanContent over CyberJudah's chapter-based plans. */
export function Plan() {
  useBackButton();
  const sheet = useSheet(), navigate = useNavigate();
  const [params] = useSearchParams();
  const [stored, setPlan, planReady] = usePlan();
  const [progress, setProgress, progressReady] = useProgress();
  const books = useQuery({ queryKey: ["books"], queryFn: data.books, staleTime: Infinity });
  const id = params.get("catalog");
  const requested = id && books.data ? cataloguePlan(id, books.data, Number(params.get("pace")) || 1) : null;
  const active = !!stored && (!id || stored.catalogId === id || stored.name === requested?.name);
  const plan = active ? stored : requested;
  const days = useMemo(() => plan && books.data ? planDays(plan, books.data, progress) : [], [plan, books.data, progress]);
  const completion = planCompletion(days);
  const [chosen, setChosen] = useState<number | null>(null);
  const [dateOpen, setDateOpen] = useState(false);
  const [success, setSuccess] = useState<"day" | "plan" | null>(null);
  const leaving = useRef(false);
  const [today, setToday] = useState(dayKey());
  const [focusVersion, setFocusVersion] = useState(0);
  const width = useRef<HTMLDivElement>(null);
  const [visibleDays, setVisibleDays] = useState(4);
  useEffect(() => {
    const refresh = () => { setFocusVersion(v => v + 1); if (!document.hidden) setToday(dayKey()); };
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, []);
  useEffect(() => { setChosen(null); }, [id]);
  useEffect(() => {
    if (!width.current) return;
    const observer = new ResizeObserver(([entry]) => setVisibleDays(Math.max(3, Math.min(7, Math.floor((entry.contentRect.width - 32) / 72)))));
    observer.observe(width.current); return () => observer.disconnect();
  }, [planReady, books.isSuccess, !!plan]);
  // The component unmounts while a reading covers it. This persisted count carries the
  // pending celebration across that boundary, without replaying an old one on every visit.
  useEffect(() => {
    if (leaving.current || !active || !stored || !planReady || !progressReady || !books.data || !days.length) return;
    const increased = stored.seenCompleted !== undefined && completion.completed > stored.seenCompleted;
    if (increased && !document.hidden) setSuccess(completion.finished ? "plan" : "day");
    if (document.hidden && increased) return;
    if (stored.day !== completion.resume || stored.seenCompleted !== completion.completed) {
      const next = increased ? advance(stored, today) : stored;
      setPlan({ ...next, day: completion.resume, seenCompleted: completion.completed });
    }
  }, [active, stored, planReady, progressReady, books.data, days.length, completion.completed, completion.resume, completion.finished, today, focusVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const byDate = active && params.get("date") && plan ? getScheduledPlanDay(plan.startedAt, params.get("date")!) : undefined;
  const selected = Math.max(0, Math.min(days.length - 1, chosen ?? (byDate === undefined ? undefined : byDate - 1) ?? (active ? completion.resume : 0)));
  const shown = days[selected];
  const choose = (day: number) => { setChosen(Math.max(0, Math.min(days.length - 1, day))); haptic("select"); };
  const openChapter = (slug: string, chapter: number) => {
    // Batch the read with navigation so the congratulations sheet appears only on return.
    leaving.current = true;
    navigate(`/read/${slug}/${chapter}`);
    setProgress(markRead(progress, slug, chapter));
  };
  const startOrRead = async () => {
    if (!plan || !shown) return;
    if (!active) {
      if (stored) {
        const answer = await sheet.open({ title: `Switch to ${plan.name}? Your completed chapters stay marked; this plan starts on day one.`, items: [{ id: "cancel", text: "Cancel" }, { id: "start", text: "Start this plan" }] });
        if (answer?.id !== "start") return;
      }
      setPlan({ ...plan, startedAt: today, seenCompleted: completion.completed, day: completion.resume });
      const first = days[0]?.chapters[0];
      if (first) openChapter(first.slug, first.chapter);
    } else {
      const next = shown.chapters.find(c => !c.read) ?? shown.chapters[0];
      if (next) openChapter(next.slug, next.chapter);
    }
  };
  const menu = async () => {
    if (!plan) return;
    const answer = await sheet.open({ title: plan.name ?? "Reading plan", items: [
      ...(active ? [{ id: "date", text: "Change start date", icon: <Feather name="clock" size={20} /> }, { id: "reset", text: "Reset", icon: <Feather name="rotate-ccw" size={20} /> }, { id: "stop", text: "Stop this plan", icon: <Feather name="trash-2" size={20} />, destructive: true }] : []),
    ] });
    if (answer?.id === "date") setDateOpen(true);
    // Bible Strong's Reset restarts the plan from today. The chapters stay marked read: the bot shares them.
    if (answer?.id === "reset" && stored) {
      const confirmed = await sheet.open({ title: `Warning: Restart ${plan.name ?? "Whole Bible with Apocrypha"}? Your completed chapters stay marked.`, items: [{ id: "cancel", text: "Cancel" }, { id: "reset", text: "Reset", destructive: true }] });
      if (confirmed?.id === "reset") { setPlan({ ...stored, startedAt: today, streak: 0, lastDone: undefined }); setChosen(null); }
    }
    if (answer?.id === "stop") {
      const confirmed = await sheet.open({ title: "Warning: Are you sure you want to stop this plan?", items: [{ id: "cancel", text: "Cancel" }, { id: "remove", text: "Remove", destructive: true }] });
      if (confirmed?.id === "remove") { setPlan(null); navigate("/plans", { replace: true }); }
    }
  };
  if (!planReady || !progressReady || books.isPending) return <Screen title="Reading plan"><Skeleton rows={4} /></Screen>;
  if (books.isError) return <Screen title="Reading plan"><Empty title="Your plan did not load" action={{ label: "Retry", onClick: () => void books.refetch() }}>Check your connection. Your plan and what you have read are safe.</Empty></Screen>;
  if (!plan) return <Screen title="Reading plan"><Empty title="No journeys started yet. Discover a reading plan to begin." action={{ label: "Explore reading plans", href: "/plans" }} /></Screen>;
  const start = Math.max(0, Math.min(selected - Math.floor(visibleDays / 2), days.length - visibleDays));
  const selectedDate = active ? getPlanDayDate(plan.startedAt, selected + 1) : undefined;
  const scheduled = getScheduledPlanDay(plan.startedAt, today) ?? 1;
  const missed = active ? days.filter(day => day.day + 1 < scheduled && !day.done) : [];
  const description = PLAN_CATALOGUE.find(p => p.id === plan.catalogId)?.description;
  return <Screen title={plan.name ?? "Reading plan"} className="reading-plan" action={active ? <button type="button" className="icon-btn" aria-label="Plan options" onClick={() => void menu()}><Feather name="more-vertical" size={18} /></button> : undefined}>
    <div className="reading-plan__content">
      <div className="reading-plan__intro"><h2>{plan.name ?? "Whole Bible with Apocrypha"}</h2>{active ? <div className="reading-plan__progress"><span><i style={{ width: `${days.length ? completion.completed / days.length * 100 : 0}%` }} /></span>{completion.finished ? <small>Journey completed</small> : null}</div> : null}</div>
      {!active && description ? <p className="reading-plan__description">{description}</p> : null}
      {!shown ? <Empty title="No readings available." /> : <>
        <div className="reading-plan__calendar" ref={width}>
          <div className="reading-plan__dayhead"><h3>Day {selected + 1} of {days.length}</h3><div><button type="button" aria-label="Previous day" disabled={selected === 0} onClick={() => choose(selected - 1)}><Feather name="chevron-left" size={20} /></button><button type="button" aria-label="Next day" disabled={selected >= days.length - 1} onClick={() => choose(selected + 1)}><Feather name="chevron-right" size={20} /></button></div></div>
          <div className="reading-plan__days" role="group" aria-label="Days">{days.slice(start, start + visibleDays).map(day => {
            const date = active ? getPlanDayDate(plan.startedAt, day.day + 1) : undefined;
            return <button type="button" key={day.day} aria-label={`Day ${day.day + 1}${day.done ? ", Day completed" : ""}`} aria-pressed={selected === day.day} onClick={() => choose(day.day)}><b data-done={day.done || undefined} data-selected={selected === day.day || undefined}>{day.done ? <Feather name="check" size={20} /> : day.day + 1}</b>{date ? <small>{date === today ? "Today" : <>{new Date(`${date}T12:00:00`).toLocaleDateString("en", { month: "short" })}<br />{Number(date.slice(-2))}</>}</small> : day.done ? <small>{day.day + 1}</small> : null}</button>;
          })}</div>
          {selectedDate ? <DatePicker value={selectedDate} label="Choose a reading date" minimum={plan.startedAt} maximum={getPlanDayDate(plan.startedAt, days.length)} onChange={date => choose((getScheduledPlanDay(plan.startedAt, date) ?? 1) - 1)} /> : null}
          {missed.length ? <button type="button" className="reading-plan__missed" onClick={() => choose(missed[0].day)}>{missed.length} {missed.length === 1 ? "reading" : "readings"} to revisit</button> : null}
          <div className="reading-plan__preview">{shown.chapters.map(c => <div key={`${c.slug}/${c.chapter}`} className="reading-plan__chapter" onClickCapture={event => { if (active && (event.target as HTMLElement).closest(".row")) { leaving.current = true; setProgress(markRead(progress, c.slug, c.chapter)); } }}>
            {active ? <button type="button" role="checkbox" aria-checked={c.read} aria-label={`${c.book} ${c.chapter}`} className="reading-plan__check" onClick={() => { choose(selected); setProgress(c.read ? unmarkRead(progress, c.slug, c.chapter) : markRead(progress, c.slug, c.chapter)); }}><span>{c.read ? <Feather name="check" size={18} /> : null}</span></button> : null}
            <Row title={`${c.book} ${c.chapter}`} leading={<Feather name="book-open" size={20} color="var(--text-3)" />} href={`/read/${c.slug}/${c.chapter}`} />
          </div>)}</div>
        </div>
        <Button onClick={() => void startOrRead()}>{active ? shown.done ? "Read again" : "Continue my journey" : "Start this plan"}</Button>
        {active ? <button type="button" className="reading-plan__complete" onClick={() => { choose(selected); setProgress(shown.chapters.reduce((next, c) => shown.done ? unmarkRead(next, c.slug, c.chapter) : markRead(next, c.slug, c.chapter), progress)); }}>{shown.done ? "Mark as unread" : "Mark as read"}</button> : null}
      </>}
    </div>
    <Sheet open={dateOpen} onClose={() => setDateOpen(false)} title="Change start date"><div className="reading-plan__date-sheet"><DatePicker label="Start date" value={plan.startedAt} onChange={date => { if (stored) setPlan({ ...stored, startedAt: date }); setDateOpen(false); }} /></div></Sheet>
    <PlanSuccess kind={success} onClose={() => setSuccess(null)} />
  </Screen>;
}

export function DatePicker({ value, label, onChange, minimum, maximum }: { value: string; label: string; onChange: (value: string) => void; minimum?: string; maximum?: string }) {
  return <label className="reading-plan__date"><span>{new Date(`${value}T12:00:00`).toLocaleDateString("en", { day: "numeric", month: "long", year: "numeric" })}</span><Feather name="chevron-down" size={16} /><input type="date" aria-label={label} value={value} min={minimum} max={maximum} onChange={e => { const date = e.target.value; if (isCivilDate(date) && (!minimum || date >= minimum) && (!maximum || date <= maximum)) onChange(date); }} /></label>;
}

function PlanSuccess({ kind, onClose }: { kind: "day" | "plan" | null; onClose: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!kind || !host.current) return;
    let cancelled = false, animation: import("lottie-web").AnimationItem | undefined;
    const container = host.current;
    void Promise.all([import("lottie-web"), kind === "plan" ? import("./plan-assets/crown.json") : import("./plan-assets/medal.json")]).then(([lottie, data]) => {
      if (cancelled) return;
      const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
      animation = lottie.default.loadAnimation({ container, renderer: "svg", loop: !reduce, autoplay: !reduce, animationData: data.default });
      if (reduce) animation.goToAndStop(60, true);
    });
    return () => { cancelled = true; animation?.destroy(); };
  }, [kind]);
  return <Sheet open={!!kind} onClose={onClose} dismissible={false} draggable={false} title="Congratulations" className="reading-plan__success"><div className="reading-plan__celebration"><div ref={host} className="reading-plan__animation" aria-hidden="true" /><div className="reading-plan__congratulations"><b>Congratulations {kind === "plan" ? "!!" : "!"}</b><p>{kind === "plan" ? "You have completed this plan !" : "You have just finished your reading."}</p></div><Button onClick={onClose}>Continue</Button></div></Sheet>;
}
