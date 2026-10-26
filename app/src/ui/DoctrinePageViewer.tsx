import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import type { DoctrineBookPage } from "@/api/data";
import { sheetOpened } from "@/tg/hooks";
import { useModal } from "@/ui/modal";
import { toAppPath } from "@shared/links.mjs";
import "./DoctrinePageViewer.css";

export function DoctrinePageViewer({ page, title, onClose }: { page: DoctrineBookPage; title: string; onClose: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useModal(dialog, true, onClose);
  useEffect(() => {
    const off = sheetOpened(), element = dialog.current;
    const dismiss = () => close.current();
    element?.addEventListener("cj:close", dismiss);
    return () => { off(); element?.removeEventListener("cj:close", dismiss); };
  }, []);
  return createPortal(<div ref={dialog} className="dpv" role="dialog" aria-modal="true" aria-label={`Page scan of ${title}`} data-sheet-open>
    <PageScan page={page} title={title} onClose={onClose} />
  </div>, document.body);
}

function PageScan({ page, title, onClose }: { page: DoctrineBookPage; title: string; onClose: () => void }) {
  const viewport = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLSpanElement>(null);
  const scale = useRef(1);
  const [view, setView] = useState({ scale: 1, left: 0, top: 0 });
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(!page.scan);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ scale: number; left: number; top: number; x: number; y: number; dist: number; moved: boolean } | null>(null);
  const lastTap = useRef(0);
  const label = page.vol === 1 ? `p. ${page.page}` : `vol. ${page.vol}, p. ${page.page}`;
  const boxes = (page.quotes ?? []).flatMap((quote) => quote.highlight);
  const commit = (next: number, left: number, top: number) => {
    scale.current = next;
    setView({ scale: next, left, top });
  };
  const zoom = (value: number, at?: { x: number; y: number }) => {
    const el = viewport.current;
    if (!el) return;
    const next = Math.max(1, Math.min(5, value)), rect = el.getBoundingClientRect();
    const x = at ? at.x - rect.left : el.clientWidth / 2;
    const y = at ? at.y - rect.top : el.clientHeight / 2;
    commit(next, (el.scrollLeft + x) / scale.current * next - x, (el.scrollTop + y) / scale.current * next - y);
  };
  useLayoutEffect(() => { viewport.current?.scrollTo({ left: view.left, top: view.top }); }, [view]);
  useEffect(() => {
    if (!ready || !first.current || !viewport.current) return;
    const el = viewport.current, mark = first.current;
    el.scrollTo({ left: mark.offsetLeft - (el.clientWidth - mark.offsetWidth) / 2, top: mark.offsetTop - (el.clientHeight - mark.offsetHeight) / 2 });
  }, [ready]);
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoom(scale.current * (e.deltaY < 0 ? 1.15 : 1 / 1.15), { x: e.clientX, y: e.clientY });
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  const begin = () => {
    const el = viewport.current, pts = [...pointers.current.values()];
    if (!el || !pts.length) return;
    gesture.current = {
      scale: scale.current, left: el.scrollLeft, top: el.scrollTop,
      x: pts.length > 1 ? (pts[0].x + pts[1].x) / 2 : pts[0].x,
      y: pts.length > 1 ? (pts[0].y + pts[1].y) / 2 : pts[0].y,
      dist: pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0, moved: false,
    };
  };
  const down = (e: RPointerEvent<HTMLDivElement>) => {
    if (!ready) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture(e.pointerId);
    begin();
  };
  const move = (e: RPointerEvent<HTMLDivElement>) => {
    const el = viewport.current, g = gesture.current;
    if (!el || !g || !pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    if (pts.length > 1 && g.dist) {
      const rect = el.getBoundingClientRect(), x = (pts[0].x + pts[1].x) / 2 - rect.left, y = (pts[0].y + pts[1].y) / 2 - rect.top;
      const next = Math.max(1, Math.min(5, g.scale * Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) / g.dist));
      commit(next, (g.left + g.x - rect.left) / g.scale * next - x, (g.top + g.y - rect.top) / g.scale * next - y);
      g.moved = true;
    } else {
      const dx = e.clientX - g.x, dy = e.clientY - g.y;
      if (Math.hypot(dx, dy) > 6) g.moved = true;
      el.scrollTo({ left: g.left - dx, top: g.top - dy });
    }
  };
  const up = (e: RPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    const g = gesture.current;
    pointers.current.delete(e.pointerId);
    if (e.type !== "pointercancel" && g && !g.moved && !pointers.current.size) {
      const now = Date.now();
      if (now - lastTap.current < 320) { zoom(scale.current > 1 ? 1 : 2.5, { x: e.clientX, y: e.clientY }); lastTap.current = 0; }
      else lastTap.current = now;
    }
    if (pointers.current.size) begin(); else gesture.current = null;
  };
  return <>
    <header className="dpv__bar">
      <button type="button" aria-label="Close" onClick={onClose}>×</button>
      <h2 className="dpv__title">{title}<small>{label}</small></h2>
      <button type="button" aria-label="Zoom out" disabled={!ready || failed || view.scale <= 1} onClick={() => zoom(scale.current / 1.6)}>−</button>
      <button type="button" aria-label="Reset zoom" disabled={!ready || failed} onClick={() => zoom(1)}>{Math.round(view.scale * 100)}%</button>
      <button type="button" aria-label="Zoom in" disabled={!ready || failed || view.scale >= 5} onClick={() => zoom(scale.current * 1.6)}>+</button>
    </header>
    {failed ? <div className="dpv__fallback">
      <p role="status">Scan unavailable.</p>
      {(page.quotes ?? []).map((quote, i) => <blockquote key={i} style={{ whiteSpace: "pre-wrap" }}>{quote.text}</blockquote>)}
    </div> : <div ref={viewport} className="dpv__viewport" role="region" aria-label="Printed page" tabIndex={0}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      {!ready ? <p className="dpv__loading" role="status">Loading scan…</p> : null}
      <div className="dpv__canvas" data-scale={view.scale} style={{ width: `${view.scale * 100}%` }}>
        <img src={page.scan!} alt={`${title} — ${label}`} draggable={false} onLoad={() => setReady(true)} onError={() => setFailed(true)} />
        {ready ? boxes.map(([x, y, width, height], i) => <span key={i} ref={i === 0 ? first : undefined} className="dpv__highlight" aria-hidden="true"
          style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${width * 100}%`, height: `${height * 100}%` }} />) : null}
      </div>
    </div>}
    <footer className="dpv__footer">
      <Link to={toAppPath(page.url) ?? page.url} onClick={onClose}>Open in the book</Link>
      <small>Pinch to zoom · drag to pan</small>
    </footer>
  </>;
}
