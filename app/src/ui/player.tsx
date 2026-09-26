import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";

import { haptic } from "@/tg/sdk";
import { Icon, Img, thumbOf, timestamp } from "@/ui/ui";

/** The embedded recording from a moment; a new start reloads the player there. */
const embed = (id: string, start: number) => `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&playsinline=1&rel=0&start=${Math.max(0, Math.floor(start))}`;

/**
 * The recording pinned at the top of the screen, the way YouTube's player stays while the
 * page beneath scrolls: a thumbnail until it is tapped, then the video from the moment.
 */
export function Player({ video, start, playing, onPlay, title }: { video: string; start: number; playing: boolean; onPlay: () => void; title: string }) {
  return (
    <div className="player">
      <div className="player__box">
        {playing ? <iframe key={`${video}:${Math.floor(start)}`} src={embed(video, start)} title={title} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen /> : (
          <button type="button" className="watch" onClick={() => { haptic("select"); onPlay(); }} aria-label={start > 0 ? `Watch from ${timestamp(start)}` : "Watch the recording"}>
            <Img src={thumbOf(video, true)} eager /><span><Icon name="play" size={18} /> {start > 0 ? `Watch from ${timestamp(start)}` : "Watch"}</span>
          </button>
        )}
      </div>
    </div>
  );
}

/** The card that opens the notes, the way YouTube previews its comments under the video. */
export function NotesOpener({ lede, onOpen, count }: { lede?: string; onOpen: () => void; count?: string }) {
  return (
    <button type="button" className="notes-open" onClick={() => { haptic("select"); onOpen(); }}>
      <span className="notes-open__head"><Icon name="note" size={16} /><b>Class notes</b>{count ? <small>{count}</small> : null}</span>
      <span className="notes-open__lede">{lede || "The write-up of this class, with the Scripture it opens."}</span>
      <Icon name="chevron" size={16} />
    </button>
  );
}

/**
 * The notes as a sheet that slides up under the pinned player and scrolls on its own, like
 * YouTube's comments on a phone: the recording keeps playing above while you read.
 */
export function NotesSheet({ open, onClose, title = "Class notes", sub, children }: { open: boolean; onClose: () => void; title?: string; sub?: string; children: ReactNode }) {
  const [top, setTop] = useState(0);
  useLayoutEffect(() => {
    if (!open) return;
    window.scrollTo({ top: 0 });
    const measure = () => { const el = document.querySelector<HTMLElement>(".player"); setTop(el ? Math.round(el.getBoundingClientRect().bottom) : 0); };
    measure();
    const raf = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", measure); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => { document.documentElement.style.overflow = prev; };
  }, [open]);
  return (
    <section className="nsheet" data-open={open ? "" : undefined} aria-hidden={!open} style={{ top }} role="dialog" aria-label={title}>
      <header className="nsheet__head">
        <span className="nsheet__grip" aria-hidden="true" />
        <div><h2>{title}</h2>{sub ? <small>{sub}</small> : null}</div>
        <button type="button" className="nsheet__close" aria-label="Close the notes" onClick={() => { haptic("select"); onClose(); }}>×</button>
      </header>
      <div className="nsheet__body">{open ? children : null}</div>
    </section>
  );
}
