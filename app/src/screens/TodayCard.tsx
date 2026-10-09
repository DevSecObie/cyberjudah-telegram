import { useEffect, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import { useQueries } from "@tanstack/react-query";
import { useBibleSettings, webFontFamily } from "@/bible/settings";
import { share } from "@/lib/share";
import { sheetOpened } from "@/tg/hooks";
import { useModal } from "@/ui/modal";
import { Icon } from "@/ui/ui";

export type DailyVerse = { ref: string; slug: string; chapter: number; verse: number; text: string };

// Bible Strong 1dfaa0d UserWidget: vertical-stack, snap right, no loop, five days.
// Layout and paging calculations ported from react-native-reanimated-carousel 5.0.0-beta.3
// (stack.ts / ScrollViewGesture.tsx). Notices: public/licenses/home-carousel.txt.
function stackStyle(relative: number) {
  const part = Math.abs(relative) % 1;
  const eased = part < .5 ? 4 * part ** 3 : 1 - (-2 * part + 2) ** 3 / 2;
  const value = Math.sign(relative) * (Math.floor(Math.abs(relative)) + eased);
  const behind = Math.max(-3, Math.min(0, value));
  const interpolate = (input: number[], output: number[]) => {
    const end = input.findIndex(n => n >= value);
    const i = end === -1 ? input.length - 2 : Math.max(0, end - 1);
    return output[i] + (value - input[i]) / (input[i + 1] - input[i]) * (output[i + 1] - output[i]);
  };
  return {
    transform: `translateX(${Math.max(0, Math.min(1, value)) * window.innerWidth}px) scale(${1 + behind * .04}) translateY(${behind * 10}px)`,
    opacity: value < -3 || value > 1.5 ? 0 : Math.max(0, interpolate([-3, -2, 0, 1], [.25, .2, 1, .25])),
    zIndex: Math.round(interpolate([-3, 0, 1, 1.5], [1, 2, 3, 0]) * 100),
  };
}

/** Our daily verse, with its existing Worker-rendered image and Telegram sharing action. */
export function TodayCard({ verse: today, failed: todayFailed, stacked = false }: { verse?: DailyVerse; failed?: boolean; stacked?: boolean }) {
  const [offset, setOffset] = useState(0);
  const [position, setPosition] = useState(4);
  const positionRef = useRef(4);
  const updatePosition = (at: number) => { positionRef.current = at; setPosition(at); };
  const stack = useRef<HTMLElement>(null);
  const motion = useRef<{ from: number; to: number; items: Animation[] } | null>(null);
  const drag = useRef<{ id: number; x: number; y: number; from: number; width: number; lastX: number; time: number; velocity: number; moved: boolean } | null>(null);
  const swiped = useRef(false);
  const [settings] = useBibleSettings();
  const dates = Array.from({ length: 5 }, (_, i) => { const date = new Date(); date.setUTCDate(date.getUTCDate() - 4 + i); return date.toISOString().slice(0, 10); });
  const previous = useQueries({ queries: dates.slice(0, 4).map((date, i) => ({ queryKey: ["votd", date], enabled: stacked || i === offset + 4, staleTime: Infinity, queryFn: async () => {
    const response = await fetch(`/api/verse-of-day?date=${date}`);
    if (!response.ok) throw new Error("Daily verse unavailable");
    return response.json() as Promise<DailyVerse>;
  } })) });
  const verse = offset === 0 ? today : previous[offset + 4].data;
  const stop = () => {
    const current = motion.current;
    if (!current) return positionRef.current;
    const at = current.from + (current.to - current.from) * Number(current.items[0].effect?.getComputedTiming().progress ?? 1);
    motion.current = null; current.items.forEach(a => a.cancel()); updatePosition(at);
    return at;
  };
  const settle = (index: number) => {
    const to = Math.max(0, Math.min(4, index)), from = stop();
    updatePosition(to);
    if (!stacked || from === to || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setOffset(to - 4); return; }
    const items = Array.from(stack.current!.querySelectorAll<HTMLElement>(".today-card"), (card, i) => card.animate(
      Array.from({ length: 61 }, (_, n) => stackStyle(i - (from + (to - from) * n / 60))),
      { duration: 600, easing: "cubic-bezier(.25,1,.5,1)" },
    ));
    const current = { from, to, items }; motion.current = current;
    void items[0].finished.then(() => { if (motion.current === current) { motion.current = null; setOffset(to - 4); } }).catch(() => {});
  };
  useEffect(() => () => { motion.current?.items.forEach(a => a.cancel()); motion.current = null; }, []);
  const move = (e: PointerEvent<HTMLElement>) => {
    const start = drag.current; if (!start || start.id !== e.pointerId) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (!start.moved) {
      if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) { drag.current = null; return; }
      if (Math.abs(dx) < 8) return;
      start.moved = true; e.currentTarget.setPointerCapture(e.pointerId);
    }
    start.velocity = (e.clientX - start.lastX) / Math.max(1, e.timeStamp - start.time) * 1000;
    start.lastX = e.clientX; start.time = e.timeStamp;
    const next = start.from - dx / start.width;
    updatePosition(next < 0 ? next * .5 : next > 4 ? 4 + (next - 4) * .5 : next);
  };
  const release = (e: PointerEvent<HTMLElement>, cancelled = false) => {
    const start = drag.current; if (!start || start.id !== e.pointerId) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!start.moved) { if (position !== offset + 4) settle(offset + 4); return; }
    swiped.current = true; e.stopPropagation();
    if (cancelled) { settle(offset + 4); return; }
    // Upstream paging: release velocity chooses at most one adjacent page; clamp at either end.
    const step = -(e.clientX - start.x >= 0 ? 1 : -1);
    const page = (step < 0 ? Math.ceil : Math.floor)(positionRef.current);
    const velocity = start.velocity;
    const nextPage = -Math.round((-positionRef.current * start.width + velocity * 2) / start.width);
    settle(page === nextPage || -Math.sign(velocity) !== step ? page : page + step);
  };
  const [image, setImage] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { if (image) return sheetOpened(); }, [image]);
  useModal(box, image && !!verse, () => setImage(false));
  const src = verse ? `/card/${encodeURIComponent(verse.slug)}/${verse.chapter}/${verse.verse}.svg` : "";
  return <>
    <section ref={stack} className={stacked ? "today-stack" : undefined} aria-label="Daily scripture" aria-roledescription={stacked ? "carousel" : undefined} tabIndex={stacked ? 0 : undefined}
      onKeyDown={stacked ? e => { if (e.target === e.currentTarget && ["ArrowLeft", "ArrowRight"].includes(e.key)) { e.preventDefault(); settle(offset + 4 + (e.key === "ArrowRight" ? -1 : 1)); } } : undefined}
      onPointerDown={stacked ? e => { e.stopPropagation(); if (!e.isPrimary || e.button !== 0) return; swiped.current = false; drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, from: stop(), width: stack.current!.querySelector<HTMLElement>(".today-card")!.offsetWidth, lastX: e.clientX, time: e.timeStamp, velocity: 0, moved: false }; } : undefined}
      onPointerMove={stacked ? move : undefined} onPointerUp={stacked ? e => release(e) : undefined} onPointerCancel={stacked ? e => release(e, true) : undefined}
      onLostPointerCapture={stacked ? e => { if (e.target === e.currentTarget) release(e, true); } : undefined}
      onDragStart={stacked ? e => e.preventDefault() : undefined}
      onClickCapture={stacked ? e => { if (swiped.current) { swiped.current = false; e.preventDefault(); e.stopPropagation(); } } : undefined}>
    {dates.map((date, i) => {
      if (!stacked && i !== offset + 4) return null;
      const entry = i === 4 ? today : previous[i].data, failed = i === 4 ? todayFailed : previous[i].isError;
      const label = !stacked && i < 3 ? new Date(`${date}T12:00:00Z`).toLocaleDateString([], { weekday: "long", timeZone: "UTC" }) : ["Four days ago", "Three days ago", "Two days ago", "Yesterday", "Today"][i];
      return <article key={date} className="today-card" data-active={i === offset + 4 ? "" : undefined} aria-hidden={i !== offset + 4} inert={i !== offset + 4} style={stacked ? stackStyle(i - position) : undefined}>
      <header><b>{label}</b>{!stacked ? <span className="today-card__arrows"><button type="button" aria-label="Previous day's scripture" disabled={offset === -4} onClick={() => settle(i - 1)}>‹</button><button type="button" aria-label="Next day's scripture" disabled={offset === 0} onClick={() => settle(i + 1)}>›</button></span> : null}<Link to="/settings" aria-label="Daily verse settings"><Icon name={stacked ? "sliders" : "gear"} size={18} /></Link></header>
      <Link to={entry ? `/read/${entry.slug}/${entry.chapter}?v=${entry.verse}` : "/bible"} className="today-card__verse" style={{ fontFamily: webFontFamily(settings.fontFamily) }}>{entry ? <><p style={{ fontFamily: "inherit", fontSize: `${(stacked ? 16 : 19) * (1 + settings.fontSizeScale * .1)}px` }}>{entry.text}</p><b>{entry.ref}{stacked ? " - " : " "}<small>KJV</small></b></> : <p role="status">{failed ? "The day's verse is unavailable. Open the Bible." : "Loading the day's verse…"}</p>}</Link>
      {!stacked ? <div className="today-card__days" role="group" aria-label="Daily scripture days">
        {dates.map((d, j) => <button key={d} type="button" aria-label={j === 4 ? "Today's scripture" : `Scripture for ${d}`} aria-pressed={offset === j - 4} onClick={() => settle(j)}><span aria-hidden="true">{j === 4 ? "•" : new Date(`${d}T12:00:00Z`).toLocaleDateString([], { weekday: "narrow", timeZone: "UTC" })}</span></button>)}
      </div> : null}
      <footer>
        {stacked && i === 4 ? <Link to="/settings/reminders" aria-label="Reading reminders"><Icon name="bell-outline" size={16} /></Link> : null}
        <button type="button" aria-label="Share" disabled={!entry} onClick={() => { if (entry) void share({ kind: "verse", title: entry.ref, text: entry.text, sitePath: `/bible/${entry.slug}/${entry.chapter}`, verses: String(entry.verse) }); }}><Icon name={stacked ? "share-nodes" : "share"} size={stacked ? 16 : 17} />{!stacked && "Share"}</button>
        <button type="button" aria-label="Image" disabled={!entry} onClick={() => setImage(true)}><Icon name="image" size={stacked ? 16 : 17} />{!stacked && "Image"}</button>
      </footer>
      </article>;
    })}
    </section>
    {image && verse ? createPortal(<div className="sheet__scrim" onClick={(e) => { if (e.target === e.currentTarget) setImage(false); }}>
      <div ref={box} className="sheet today-image" role="dialog" aria-modal="true" aria-label="Verse image" data-sheet-open="">
        <p className="sheet__title">{verse.ref}</p>
        <img src={src} alt={`${verse.ref}: ${verse.text}`} />
        <a className="btn" href={src} download={`${verse.slug}-${verse.chapter}-${verse.verse}.svg`}>Save image</a>
        <button type="button" className="sheet__cancel" data-autofocus onClick={() => setImage(false)}>Close</button>
      </div>
    </div>, document.getElementById("root")!) : null}
  </>;
}
