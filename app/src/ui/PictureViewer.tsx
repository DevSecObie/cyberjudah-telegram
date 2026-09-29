import { useEffect, useRef, useState, type PointerEvent as RPointerEvent, type WheelEvent as RWheelEvent } from "react";
import { useNavigate } from "react-router";

import { DATA_ORIGIN, fmtDate, type BookFigure, type LibraryBook, type SaidLine } from "@/api/data";
import { Frame } from "@/lib/frames";
import { sheetOpened } from "@/tg/hooks";
import { haptic } from "@/tg/sdk";
import { Icon, timestamp } from "@/ui/ui";

/**
 * A book's picture full screen, with what the classes said as they showed it.
 *
 * The picture pinches and drags like a photo (two fingers or the wheel to zoom, one finger to
 * pan, a double tap to jump in and out); when it is not zoomed, a swipe moves to the next or
 * previous picture. Under it, a panel lists every class that read this page: the moment, the
 * frame of the recording, and the words spoken, each line taking the reader to that second.
 */

const src = (u: string) => (u.startsWith("/") ? `${DATA_ORIGIN}${u}` : u);
const KIND: Record<BookFigure["kind"], string> = { foldout: "Fold-out map", plate: "Plate", figure: "Figure" };
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function PictureViewer({ figure, figures, book, onClose, onChange }: { figure: BookFigure; figures?: BookFigure[]; book: LibraryBook; onClose: () => void; onChange?: (f: BookFigure) => void }) {
  const navigate = useNavigate();
  const list = figures?.length ? figures : [figure];
  const index = Math.max(0, list.findIndex((f) => f.file === figure.file));
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [words, setWords] = useState(figure.readings.length > 0);
  const [entered, setEntered] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ scale: number; dist: number; pos: { x: number; y: number }; mid: { x: number; y: number }; moved: boolean; start: number } | null>(null);
  const lastTap = useRef(0);
  useEffect(() => { const off = sheetOpened(); const id = requestAnimationFrame(() => setEntered(true)); return () => { off(); cancelAnimationFrame(id); }; }, []);
  useEffect(() => { setScale(1); setPos({ x: 0, y: 0 }); setWords(figure.readings.length > 0); }, [figure.file, figure.readings.length]);

  const go = (d: 1 | -1) => { const f = list[index + d]; if (f && onChange) { haptic("select"); onChange(f); } };
  const zoomTo = (s: number, at?: { x: number; y: number }) => {
    const next = clamp(s, 1, 5);
    if (at && stage.current) {
      const r = stage.current.getBoundingClientRect();
      const cx = at.x - r.left - r.width / 2, cy = at.y - r.top - r.height / 2;
      const k = next / scale;
      setPos((p) => (next === 1 ? { x: 0, y: 0 } : { x: cx - (cx - p.x) * k, y: cy - (cy - p.y) * k }));
    } else if (next === 1) setPos({ x: 0, y: 0 });
    setScale(next);
  };
  const down = (e: RPointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return; // the arrows and zoom buttons keep their clicks
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    const mid = pts.length > 1 ? { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 } : pts[0];
    gesture.current = { scale, dist: pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0, pos, mid, moved: false, start: Date.now() };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const move = (e: RPointerEvent) => {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()], g = gesture.current;
    if (pts.length > 1 && g.dist) {
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      const next = clamp(g.scale * (dist / g.dist), 1, 5);
      setScale(next); setPos({ x: g.pos.x + (mid.x - g.mid.x), y: g.pos.y + (mid.y - g.mid.y) }); g.moved = true;
    } else {
      const dx = pts[0].x - g.mid.x, dy = pts[0].y - g.mid.y;
      if (Math.hypot(dx, dy) > 6) g.moved = true;
      if (scale > 1) setPos({ x: g.pos.x + dx, y: g.pos.y + dy });
      else setPos({ x: dx * 0.6, y: 0 });
    }
  };
  const up = (e: RPointerEvent) => {
    const g = gesture.current;
    pointers.current.delete(e.pointerId);
    if (!g || pointers.current.size) return;
    gesture.current = null;
    if (scale <= 1) {
      const dx = pos.x / 0.6;
      if (Math.abs(dx) > 70 && list.length > 1 && onChange) go(dx < 0 ? 1 : -1);
      setPos({ x: 0, y: 0 }); setScale(1);
    }
    if (!g.moved && Date.now() - g.start < 350) {
      const now = Date.now();
      if (now - lastTap.current < 320) { zoomTo(scale > 1 ? 1 : 2.5, { x: e.clientX, y: e.clientY }); lastTap.current = 0; }
      else lastTap.current = now;
    }
  };
  const wheel = (e: RWheelEvent) => { e.preventDefault(); zoomTo(scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15), { x: e.clientX, y: e.clientY }); };
  const watch = (video: string, t: number) => { haptic("select"); onClose(); navigate(`/watch/${video}?t=${t}`); };

  const volumeLabel = book.chapters.find((c) => c.vol === figure.vol)?.volume;
  const where = figure.page != null ? `${figure.kind === "foldout" ? "facing " : ""}${book.volumes > 1 ? `${volumeLabel && !/^Volume \d+$/.test(volumeLabel) ? volumeLabel : `vol. ${figure.vol}`}, ` : ""}p. ${figure.page}` : "";
  const name = figure.title || KIND[figure.kind];
  return (
    <div className={`pv${entered ? " pv--in" : ""}${words ? " pv--words" : ""}`} role="dialog" aria-label={name} data-sheet-open>
      <div className="pv__bar">
        <button type="button" className="pv__btn" aria-label="Close" onClick={onClose}><Icon name="back" size={20} /></button>
        <div className="pv__title"><b>{name}</b><small>{[KIND[figure.kind], where, list.length > 1 ? `${index + 1} of ${list.length}` : ""].filter(Boolean).join(" · ")}</small></div>
        <button type="button" className="pv__btn" aria-label="Zoom out" disabled={scale <= 1} onClick={() => zoomTo(scale / 1.6)}>−</button>
        <button type="button" className="pv__btn" aria-label="Zoom in" disabled={scale >= 5} onClick={() => zoomTo(scale * 1.6)}>+</button>
      </div>
      <div ref={stage} className="pv__stage" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onWheel={wheel} style={{ touchAction: "none" }}>
        <img key={figure.file} src={src(figure.url)} alt={name} draggable={false}
          style={{ transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})`, transition: gesture.current ? "none" : "transform .28s cubic-bezier(.2,.8,.2,1)" }} />
        {list.length > 1 ? <>
          <button type="button" className="pv__nav pv__nav--prev" aria-label="Previous picture" disabled={index === 0} onClick={() => go(-1)}><Icon name="chevron" size={22} /></button>
          <button type="button" className="pv__nav pv__nav--next" aria-label="Next picture" disabled={index === list.length - 1} onClick={() => go(1)}><Icon name="chevron" size={22} /></button>
        </> : null}
        {scale > 1 ? <span className="pv__zoom">{Math.round(scale * 100)}%</span> : null}
      </div>
      <section className={`pv__panel${words ? " pv__panel--open" : ""}`} aria-label="What the classes said">
        <button type="button" className="pv__grab" onClick={() => { haptic("select"); setWords((v) => !v); }} aria-expanded={words}>
          <span className="pv__grabbar" />
          <span className="pv__grabtext">
            {figure.readings.length ? <><b>{figure.readings.length === 1 ? "What was said" : `What was said · ${figure.readings.length} classes`}</b><small>{words ? "Swipe down to see more of the picture" : "Tap to read the classes' words"}</small></> : <><b>{figure.caption || KIND[figure.kind]}</b><small>No class has shown this picture yet</small></>}
          </span>
          <Icon name="chevron" size={18} />
        </button>
        <div className="pv__scroll">
          {figure.caption && figure.caption !== figure.title ? <p className="pv__caption">{figure.caption}</p> : null}
          {figure.readings.map((r) => (
            <article key={`${r.video}-${r.t}`} className="pv__class">
              <header className="pv__classhead">
                <Frame video={r.video} t={r.t} width={120} className="pv__frame" onClick={() => watch(r.video, r.t)} />
                <div>
                  <b>{r.title || "Class"}</b>
                  <small>{[fmtDate(r.date ?? ""), r.teacher, `at ${r.ts}`].filter(Boolean).join(" · ")}</small>
                  <button type="button" className="pv__play" onClick={() => watch(r.video, r.t)}><Icon name="play" size={14} /> Watch from {r.ts}</button>
                </div>
              </header>
              <Said lines={r.said ?? []} at={r.t} onSeek={(t) => watch(r.video, t)} />
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

/** The words spoken, line by line as captioned, the line at the reading's own second marked. */
export function Said({ lines, at, onSeek, compact }: { lines: SaidLine[]; at: number; onSeek: (t: number) => void; compact?: boolean }) {
  if (!lines.length) return <p className="hint">No captions around this moment.</p>;
  const here = lines.reduce((best, l, i) => (Math.abs(l.t - at) < Math.abs(lines[best].t - at) ? i : best), 0);
  // Captions come in short bursts; run them into sentences of a few lines so they read like speech.
  const runs: { t: number; text: string; here: boolean }[] = [];
  lines.forEach((l, i) => {
    const text = l.text.replace(/^>>\s*/, "");
    const last = runs[runs.length - 1];
    if (last && last.text.split(" ").length < (compact ? 26 : 34) && !/[.?!]$/.test(last.text)) { last.text += ` ${text}`; if (i === here) last.here = true; }
    else runs.push({ t: l.t, text, here: i === here });
  });
  return (
    <div className={`said${compact ? " said--compact" : ""}`}>
      {runs.map((r) => (
        <p key={r.t} className="said__line" data-here={r.here ? "" : undefined}>
          <button type="button" onClick={() => onSeek(r.t)} aria-label={`Play from ${timestamp(r.t)}`}>{timestamp(r.t)}</button>{r.text}
        </p>
      ))}
    </div>
  );
}
