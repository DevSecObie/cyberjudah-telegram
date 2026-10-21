import { useQuery } from "@tanstack/react-query";
import { createContext, Fragment, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";

import { data } from "@/api/data";
import { Feather } from "@/bible/icons";
import type { Note } from "@/bible/store";
import { native } from "@/native/platform";
import { useModal } from "./modal";
import { popoverTrigger, usePopover } from "./popover";
import { RefText } from "./reftext";

export type PreviewRequest =
  | { kind: "bible"; slug: string; chapter: number; verses: string; open: () => void }
  | { kind: "note"; note: Note | null; open: () => void };

/** "1,2,3,5" -> "1-3,5". */
export function verseSpec(verses: number[]) {
  const out: string[] = [];
  for (const v of [...new Set(verses)].sort((a, b) => a - b)) {
    const last = out.at(-1)?.split("-");
    if (last && +last[last.length - 1] === v - 1) out[out.length - 1] = `${last[0]}-${v}`;
    else out.push(String(v));
  }
  return out.join(",");
}

function wantedVerses(spec: string) {
  if (!spec) return null;
  const set = new Set<number>();
  for (const part of spec.split(",")) {
    const [a, b = a] = part.split("-").map(Number);
    for (let v = a; v <= b; v++) set.add(v);
  }
  return set;
}

/** A reader path, "/read/genesis/1?v=1-3", as a passage to preview. */
export function bibleRequest(href: string, open: () => void): PreviewRequest | null {
  const m = /\/read\/([a-z0-9-]+)\/(\d+)(?:\?v=([\d,-]+))?/.exec(href.replace(/&amp;/g, "&"));
  return m ? { kind: "bible", slug: m[1], chapter: +m[2], verses: m[3] ?? "", open } : null;
}

const PreviewContext = createContext<(request: PreviewRequest, from?: HTMLElement | null) => boolean>(() => false);
/**
 * Bible Strong's useReferencePreview: false where it doesn't preview (the iOS and Android apps keep
 * their direct navigation), so the caller navigates as before.
 */
export const useReferencePreview = () => useContext(PreviewContext);

/**
 * Bible Strong's ReferencePreviewHost: a reference tapped in content opens its passage in a card
 * anchored to it, instead of leaving the page. A reference inside the card adds to its history,
 * with Back; Open goes where the reference went; closing leaves the page as it was.
 */
export function ReferencePreviewProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [history, setHistory] = useState<PreviewRequest[]>([]);
  const box = useRef<HTMLDivElement>(null);
  const anchor = useRef<{ element: HTMLElement | null; rect: DOMRect | null }>({ element: null, rect: null });
  const preview = useCallback((request: PreviewRequest, from?: HTMLElement | null) => {
    if (native) return false;
    const element = from ?? popoverTrigger();
    const nested = !!element && !!box.current?.contains(element);
    if (!nested) anchor.current = { element, rect: element?.getBoundingClientRect() ?? null };
    setHistory((h) => (nested && h.length ? [...h, request] : [request]));
    return true;
  }, []);

  // Every scripture link in content: RefText's and an answer's a.reflink, ReferenceText's links.
  useEffect(() => {
    if (native) return;
    const click = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.<HTMLAnchorElement>("a.reflink, a[data-ref-preview]");
      if (!a || a.dataset.previewOpen !== undefined) return;
      const href = a.getAttribute("href") ?? "";
      const request = bibleRequest(href, () => {
        // Open runs the link's own navigation.
        if (a.isConnected) { a.dataset.previewOpen = ""; a.click(); delete a.dataset.previewOpen; }
        else { const r = bibleRequest(href, () => {}); if (r?.kind === "bible") navigate(`/read/${r.slug}/${r.chapter}${r.verses ? `?v=${r.verses}` : ""}`); }
      });
      if (!request) return;
      e.preventDefault(); e.stopPropagation();
      preview(request, a);
    };
    document.addEventListener("click", click, true);
    return () => document.removeEventListener("click", click, true);
  }, [preview, navigate]);

  const request = history.at(-1);
  const shown = useRef(request);
  if (request) shown.current = request;
  const open = !!request;
  const close = useCallback(() => setHistory([]), []);
  const present = usePopover(open, box);
  useModal(box, open && present, close, { lock: false, trap: false });

  useLayoutEffect(() => {
    const el = box.current;
    if (!present || !el) return;
    let frame = 0;
    const place = () => {
      frame = 0;
      const { element, rect } = anchor.current;
      const from = element?.isConnected ? element.getBoundingClientRect() : rect;
      const bounds = el.parentElement!.getBoundingClientRect();
      const width = el.offsetWidth, height = el.offsetHeight, gap = 8;
      if (!from) { el.style.left = `${(bounds.width - width) / 2}px`; el.style.top = `${gap}px`; return; }
      const left = Math.max(gap, Math.min(from.left + from.width / 2 - bounds.left - width / 2, bounds.width - width - gap));
      const below = from.bottom - bounds.top + gap;
      const top = below + height <= bounds.height - gap ? below : Math.max(gap, from.top - bounds.top - height - gap);
      el.style.left = `${left}px`; el.style.top = `${Math.min(top, bounds.height - height - gap)}px`;
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(place); };
    place();
    const observer = new ResizeObserver(schedule); observer.observe(el); observer.observe(el.parentElement!);
    window.addEventListener("scroll", schedule, true); window.addEventListener("resize", schedule);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener("scroll", schedule, true); window.removeEventListener("resize", schedule); };
  }, [present, request]);

  const openFull = () => { const r = request; if (!r) return; close(); r.open(); };
  const books = useQuery({ queryKey: ["books"], queryFn: data.books, staleTime: Infinity });
  const current = shown.current;
  const title = useMemo(() => {
    if (!current) return "";
    if (current.kind === "note") return "Note";
    const book = books.data?.find((b) => b.slug === current.slug)?.book ?? current.slug;
    return `${book} ${current.chapter}${current.verses ? `:${current.verses}` : ""} · KJV`;
  }, [current, books.data]);

  return (
    <PreviewContext.Provider value={preview}>
      {children}
      {present && current ? (
        <div className="sheet__scrim" data-anchored="" data-modal={open ? "" : undefined} onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
          <div ref={box} className="sheet refpreview" data-popover="" inert={!open} aria-hidden={!open} role="dialog" aria-modal={false} aria-label={title} data-sheet-open="">
            <div className="refpreview__head">
              {history.length > 1
                ? <button type="button" className="refpreview__btn" aria-label="Back" title="Back" onClick={() => setHistory((h) => h.slice(0, -1))}><Feather name="arrow-left" size={18} /></button>
                : <span className="refpreview__btn" />}
              <b className="refpreview__title">{title}</b>
              <button type="button" className="refpreview__btn" data-primary="" aria-label="Open" title="Open" onClick={openFull}><Feather name="external-link" size={18} /></button>
            </div>
            <div className="refpreview__body">
              {current.kind === "bible" ? <Passage slug={current.slug} chapter={current.chapter} verses={current.verses} /> : <NoteBody note={current.note} />}
            </div>
          </div>
        </div>
      ) : null}
    </PreviewContext.Provider>
  );
}

function Passage({ slug, chapter, verses }: { slug: string; chapter: number; verses: string }) {
  const text = useQuery({ queryKey: ["chapter", slug, chapter], queryFn: () => data.chapter(slug, chapter), staleTime: Infinity });
  const wanted = wantedVerses(verses);
  const list = text.data?.verses.filter((v) => !wanted || wanted.has(v.verse)) ?? [];
  if (text.isPending) return <p className="refpreview__state" role="status">Loading…</p>;
  if (!list.length) return <div className="refpreview__state"><p>This passage can't be shown.</p><button type="button" className="refpreview__retry" onClick={() => void text.refetch()}>Retry</button></div>;
  return <p className="refpreview__text">{list.map((v) => <Fragment key={v.verse}><span className="refpreview__num">{v.verse} </span>{v.text}{" "}</Fragment>)}</p>;
}

function NoteBody({ note }: { note: Note | null }) {
  if (!note) return <p className="refpreview__state">This note no longer exists</p>;
  return <>
    {note.title.trim() ? <b className="refpreview__notetitle">{note.title}</b> : null}
    <p className="refpreview__text"><RefText text={note.description} /></p>
  </>;
}
