import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from "react";

import { haptic } from "@/tg/sdk";
import { Icon, Img, THUMB_BIG, thumbOf, timestamp } from "@/ui/ui";
import { BackgroundExtension } from "@/ui/BackgroundExtension";
import { Frame } from "@/lib/frames";

/** The embedded recording from a moment; a new start reloads the player there. */
const embed = (id: string, start: number) => `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&playsinline=1&rel=0&start=${Math.max(0, Math.floor(start))}`;

/**
 * The recording pinned at the top of the screen, the way YouTube's player stays while the
 * page beneath scrolls: a thumbnail until it is tapped, then the video from the moment.
 * With `pip` it shrinks to a floating corner picture, still playing, while the notes take
 * the whole screen; a tap on its corner button brings it back to the top.
 */
export function Player({ video, start, playing, onPlay, title, live, pip, onExpand }: { video: string; start: number; playing: boolean; onPlay: () => void; title: string; live?: boolean; pip?: boolean; onExpand?: () => void }) {
  return (
    <div className="player" data-pip={pip ? "" : undefined}>
      {!pip && !playing ? <BackgroundExtension src={thumbOf(video, true)} /> : null}
      {pip ? <button type="button" className="player__expand" aria-label="Back to the full player" title="Back to the full player" onClick={() => { haptic("select"); onExpand?.(); }}><Icon name="chevron" size={16} /></button> : null}
      <div className="player__box">
        {playing ? <iframe key={`${video}:${Math.floor(start)}`} src={embed(video, start)} title={title} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen /> : (
          <button type="button" className="watch" onClick={() => { haptic("select"); onPlay(); }} aria-label={start > 0 ? `Watch from ${timestamp(start)}` : "Watch the recording"} title={start > 0 ? `Watch from ${timestamp(start)}` : "Watch the recording"}>
            <Img src={thumbOf(video, true)} eager {...THUMB_BIG} />{start > 0 && !live ? <Frame video={video} t={start} className="player__frame" /> : null}<span><Icon name="play" size={18} /> {live ? "Watch live" : start > 0 ? `Watch from ${timestamp(start)}` : "Watch"}</span>
          </button>
        )}
      </div>
    </div>
  );
}

/** The card that opens the notes, the way YouTube previews its comments under the video. */
export function NotesOpener({ lede, at, onSeek, onOpen, count }: { lede?: string; at?: { t: number; ts: string } | null; onSeek?: (t: number) => void; onOpen: () => void; count?: string }) {
  return (
    <div className="notes-open">
      <button type="button" className="notes-open__main" onClick={() => { haptic("select"); onOpen(); }}>
        <span className="notes-open__head"><Icon name="note" size={16} /><b>Class notes</b>{count ? <small>{count}</small> : null}</span>
        <span className="notes-open__lede">{lede || "The write-up of this class, with the Scripture it opens."}</span>
        <Icon name="chevron" size={16} />
      </button>
      {at && onSeek ? <button type="button" className="notes-open__at" onClick={() => { haptic("select"); onSeek(at.t); }}><Icon name="play" size={14} /> The teaching starts at {at.ts}</button> : null}
    </div>
  );
}

/**
 * The notes as a sheet that slides up under the pinned player and scrolls on its own, like
 * YouTube's comments on a phone: the recording keeps playing above while you read. The grip
 * drags: up, and the notes take the whole screen (the player, if it is playing, shrinks to
 * a corner picture); down, and they dock under the player again, or close from there.
 */
export function NotesSheet({ open, onClose, full = false, onFull, title = "Class notes", sub, action, children }: { open: boolean; onClose: () => void; full?: boolean; onFull?: (full: boolean) => void; title?: string; sub?: string; action?: ReactNode; children: ReactNode }) {
  const [top, setTop] = useState(0);
  const [safeTop, setSafeTop] = useState(0);
  const [drag, setDrag] = useState<number | null>(null);
  const from = useRef<{ y: number; id: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    window.scrollTo({ top: 0 });
    const measure = () => {
      const el = document.querySelector<HTMLElement>(".player:not([data-pip])");
      setTop(el ? Math.round(el.getBoundingClientRect().bottom) : 0);
      // A device inset is never negative; clamp defensively.
      setSafeTop(Math.max(0, parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--safe-top")) || 0));
    };
    measure();
    const raf = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", measure); };
  }, [open, full]);
  useEffect(() => {
    if (!open) return;
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => { document.documentElement.style.overflow = prev; };
  }, [open]);
  useEffect(() => { if (!open && full) onFull?.(false); }, [open, full, onFull]);
  const docked = full ? safeTop : top;
  const down = (e: RPointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    from.current = { y: e.clientY, id: e.pointerId };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const move = (e: RPointerEvent) => {
    if (!from.current || from.current.id !== e.pointerId) return;
    const dy = e.clientY - from.current.y;
    // Pulling past the end (up when full, down when the sheet is docked) gives with resistance.
    setDrag(full ? (dy < 0 ? dy * 0.25 : dy) : dy > 0 ? dy * 0.6 : dy);
  };
  const up = (e: RPointerEvent) => {
    if (!from.current || from.current.id !== e.pointerId) return;
    const dy = e.clientY - from.current.y;
    from.current = null;
    let goFull = full;
    let doClose = false;
    if (Math.abs(dy) < 8) goFull = !full;
    else if (dy < -50 && !full) goFull = true;
    else if (dy > 50 && full) goFull = false;
    else if (dy > 90 && !full) doClose = true;
    if (goFull !== full) {
      haptic("select");
      // `top` jumps straight to the new dock position (the player's edge or the screen's top
      // differ a lot, and nothing animates `top` itself); without carrying the release point
      // across as a starting transform, the sheet (and its grip) would render at the new top
      // plus the old drag offset — potentially off the top of the screen, out of the next
      // gesture's reach. Painting one frame at the exact release point, with no transition,
      // then releasing it to the CSS transition keeps the motion continuous instead.
      const currentY = docked + Math.max(safeTop - docked, drag ?? 0);
      const newDocked = goFull ? safeTop : top;
      onFull?.(goFull);
      setDrag(currentY - newDocked);
      requestAnimationFrame(() => requestAnimationFrame(() => setDrag(null)));
      return;
    }
    setDrag(null);
    if (doClose) { haptic("select"); onClose(); }
  };
  const style = drag !== null ? { top: docked, transform: `translateY(${Math.max(safeTop - docked, drag)}px)`, transition: "none", willChange: "transform" } : { top: docked };
  return (
    <section className="nsheet" data-open={open ? "" : undefined} data-full={full ? "" : undefined} aria-hidden={!open} style={style} role="dialog" aria-label={title}>
      <header className="nsheet__head" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} style={{ touchAction: "none" }}>
        <span className="nsheet__grip" aria-hidden="true" />
        <div><h2>{title}</h2>{sub ? <small>{sub}</small> : null}</div>
        <span className="nsheet__actions">{action}<button type="button" className="nsheet__close" aria-label="Close the notes" title="Close the notes" onClick={() => { haptic("select"); onClose(); }}>×</button></span>
      </header>
      <div className="nsheet__body">{open ? children : null}</div>
    </section>
  );
}
