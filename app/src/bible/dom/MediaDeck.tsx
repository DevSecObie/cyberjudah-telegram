import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";

import { fmtDate, type ClassMoment } from "@/api/data";
import { thumbUrl } from "@/lib/taught";
import { haptic, openLink } from "@/tg/sdk";
import { sheetOpened } from "@/tg/hooks";
import { youtube } from "@/ui/ui";
import { toAppPath } from "@shared/links.mjs";
import { Feather } from "../icons";
import type { Palette } from "../theme";
import { scaleFontSizeNumber } from "../typography";

/**
 * Bible Strong's passage media (BibleDOM/PassageMediaThumbnails, PassageMediaOverlay,
 * PassageMediaPlayer) with the classes: after the last verse a class taught, a small fanned deck of
 * its recordings' pictures; at the end of the chapter, a larger deck of every class that taught
 * it. A tap spreads the deck into a gallery over the page, each card flying from the deck to its
 * place; a card plays the class there, at the moment it read the verse.
 */
export type DeckSection = { title: string; items: ClassMoment[] };
type Placement = "inline" | "chapter";

const INLINE = { height: 25, ratio: 1.3, container: 0.7, margin: 2 };
const CHAPTER = { height: 76, ratio: 16 / 9 };
const MAX_STACKED = 3;
const SCROLL_SHRINK = { distance: 30, min: 0.2 };
export const SOURCE_STAGGER = 70, SOURCE_SETTLE = 380, EXTRA_STAGGER = 50;
// Bible Strong's spring (stiffness 360, damping 34, mass 0.8) as a curve: fast, with a slight settle.
const SPRING = "cubic-bezier(.2, 1.12, .32, 1)";
const FLY_MS = 480;

export const deckKey = (m: ClassMoment) => `${m.video}-${m.t}`;
const fan = (i: number, n: number) => { if (n <= 1) return { x: 0, r: 0 }; const p = (i / (n - 1)) * 2 - 1; return { x: p * 3, r: p * 5 }; };
export const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
const embed = (id: string, start: number) => `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&playsinline=1&rel=0&start=${Math.max(0, Math.floor(start))}`;

/** Where an element sits, with its unrotated size: a rotated card's box is larger than the card. */
export function place(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: el.offsetWidth, h: el.offsetHeight };
}
export function fly(el: HTMLElement, from: ReturnType<typeof place>, rotate: number, delay: number, reverse = false, radius: [string, string] = ["5px", "11px"]) {
  const to = place(el);
  const start = `translate(${from.cx - to.cx}px, ${from.cy - to.cy}px) scale(${from.w / to.w}, ${from.h / to.h}) rotate(${rotate}deg)`;
  const frames = [{ transform: start, borderRadius: radius[0] }, { transform: "none", borderRadius: radius[1] }];
  return el.animate(reverse ? frames.reverse() : frames, { duration: reduced() ? 0 : reverse ? 300 : FLY_MS, delay: reduced() ? 0 : delay, easing: reverse ? "cubic-bezier(.4, 0, .2, 1)" : SPRING, fill: "both" });
}

export function MediaDeck({ items, placement, palette: c, fontScale, sections, reference, from, disabled }: {
  items: ClassMoment[]; placement: Placement; palette: Palette; fontScale: number; sections?: DeckSection[]; reference: string; from: string; disabled?: boolean;
}) {
  const stack = useRef<HTMLButtonElement>(null);
  const [mode, setMode] = useState<"closed" | "gallery" | "playing">("closed");
  const [selected, setSelected] = useState<ClassMoment | null>(null);
  const [scale, setScale] = useState(1);
  const shown = items.slice(0, MAX_STACKED);
  const inline = placement === "inline";

  // Inline decks shrink away as they reach the header, as in Bible Strong.
  useEffect(() => {
    if (!inline || mode !== "closed" || reduced()) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const el = stack.current; if (!el) return;
      const header = document.querySelector(".bs-header")?.getBoundingClientRect().bottom ?? 0;
      const top = el.getBoundingClientRect().top;
      const p = Math.min(Math.max((header + SCROLL_SHRINK.distance - top) / SCROLL_SHRINK.distance, 0), 1);
      setScale(1 - p * (1 - SCROLL_SHRINK.min));
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => { window.removeEventListener("scroll", onScroll, { capture: true }); cancelAnimationFrame(frame); };
  }, [inline, mode]);

  if (!items.length) return null;
  const cardH = inline ? scaleFontSizeNumber(INLINE.height, fontScale) : CHAPTER.height;
  const cardW = inline ? cardH * INLINE.ratio : CHAPTER.height * CHAPTER.ratio;
  const boxH = inline ? cardH * INLINE.container : cardH;
  const boxW = inline ? cardW * INLINE.container : cardW;
  const style: CSSProperties = {
    position: "relative", display: inline ? "inline-grid" : "grid", width: boxW, height: boxH,
    margin: inline ? `0 ${INLINE.margin}px` : 0, overflow: "visible", isolation: "isolate",
    padding: 0, border: 0, background: "transparent", cursor: disabled ? "default" : "pointer", verticalAlign: "middle",
    transformOrigin: "center bottom", transform: scale < 1 ? `scale(${scale})` : undefined, WebkitTapHighlightColor: "transparent",
  };
  return (
    <>
      <button ref={stack} type="button" className="bs-deck" data-ignore-verse-touch="" disabled={disabled} style={style}
        aria-label={`${items.length === 1 ? "A class" : `${items.length} classes`} taught this: ${items.map((m) => m.label).join(", ")}`}
        onClick={(e) => { e.stopPropagation(); if (disabled) return; haptic("select"); setMode("gallery"); }}>
        {shown.map((m, i) => {
          const f = fan(i, shown.length);
          return (
            <span key={deckKey(m)} data-deck-card={deckKey(m)} data-rotate={f.r} className="bs-deck__card"
              style={{ width: cardW, height: cardH, borderColor: c.reverse, borderRadius: inline ? 5 : 9, transform: `translateX(${f.x}px) rotate(${f.r}deg)`, zIndex: i + 1, visibility: mode === "closed" ? undefined : "hidden" }}>
              <DeckImage video={m.video} />
            </span>
          );
        })}
      </button>
      {mode !== "closed" ? (
        <DeckOverlay items={items} sections={placement === "chapter" ? sections : undefined} source={stack} palette={c} reference={reference} from={from}
          mode={mode} selected={selected}
          onSelect={(m) => { setSelected(m); setMode("playing"); }}
          onClosed={() => { setMode("closed"); setSelected(null); }} />
      ) : null}
    </>
  );
}

function DeckImage({ video, children, hidden }: { video: string; children?: ReactNode; hidden?: boolean }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <>
      <img src={thumbUrl(video)} alt="" loading="lazy" decoding="async" draggable={false} onLoad={() => setLoaded(true)}
        style={{ opacity: loaded && !hidden ? 1 : 0 }} />
      {children}
    </>
  );
}

function DeckOverlay({ items, sections, source, palette: c, reference, from, mode, selected, onSelect, onClosed }: {
  items: ClassMoment[]; sections?: DeckSection[]; source: React.RefObject<HTMLButtonElement | null>; palette: Palette; reference: string; from: string;
  mode: "gallery" | "playing"; selected: ClassMoment | null; onSelect: (m: ClassMoment) => void; onClosed: () => void;
}) {
  const navigate = useNavigate();
  const root = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  const [closing, setClosing] = useState(false);
  const [ready, setReady] = useState(false);
  const picked = useRef<ReturnType<typeof place> | null>(null);
  const sourceKeys = [...(source.current?.querySelectorAll<HTMLElement>("[data-deck-card]") ?? [])].map((el) => el.dataset.deckCard!);
  const list = sections?.length ? sections.flatMap((s) => s.items).filter((m, i, all) => all.findIndex((x) => deckKey(x) === deckKey(m)) === i) : items;
  const extras = list.filter((m) => !sourceKeys.includes(deckKey(m)));
  const extraStart = sourceKeys.length ? (sourceKeys.length - 1) * SOURCE_STAGGER + SOURCE_SETTLE : 160;
  const delayOf = (m: ClassMoment) => { const i = sourceKeys.indexOf(deckKey(m)); return i >= 0 ? i * SOURCE_STAGGER : extraStart + extras.findIndex((x) => deckKey(x) === deckKey(m)) * EXTRA_STAGGER; };

  // The deck's cards fly to their places in the gallery; the others fade in after them.
  useLayoutEffect(() => {
    if (mode !== "gallery") return;
    setShown(true);
    const deck = source.current;
    const cards = root.current?.querySelectorAll<HTMLElement>("[data-gallery-card]") ?? [];
    for (const card of cards) {
      const key = card.dataset.galleryCard!;
      const from = deck?.querySelector<HTMLElement>(`[data-deck-card="${CSS.escape(key)}"]`);
      if (from) fly(card, place(from), Number(from.dataset.rotate ?? 0), delayOf(items.find((m) => deckKey(m) === key) ?? list.find((m) => deckKey(m) === key)!));
      else card.animate([{ opacity: 0 }, { opacity: 1 }], { duration: reduced() ? 0 : 200, delay: reduced() ? 0 : delayOf(list.find((m) => deckKey(m) === key)!), fill: "both" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // The chosen card grows into the player.
  useLayoutEffect(() => {
    if (mode !== "playing" || !selected) return;
    setReady(false);
    const box = root.current?.querySelector<HTMLElement>(".bs-player__box");
    if (box && picked.current) fly(box, picked.current, 0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, selected]);

  // Telegram's back button closes the gallery first.
  useEffect(() => sheetOpened(), []);

  // Close: the deck's cards fly home and the page comes back.
  const close = () => {
    if (closing) return;
    setClosing(true); setShown(false);
    const deck = source.current;
    const anims: Animation[] = [];
    if (mode === "gallery" && deck) {
      for (const card of root.current?.querySelectorAll<HTMLElement>("[data-gallery-card]") ?? []) {
        const from = deck.querySelector<HTMLElement>(`[data-deck-card="${CSS.escape(card.dataset.galleryCard!)}"]`);
        if (from) { card.getAnimations().forEach((a) => a.cancel()); anims.push(fly(card, place(from), Number(from.dataset.rotate ?? 0), 0, true)); }
        else anims.push(card.animate([{ opacity: 1 }, { opacity: 0 }], { duration: reduced() ? 0 : 160, fill: "both" }));
      }
    }
    window.setTimeout(onClosed, reduced() ? 0 : anims.length ? 300 : 200);
  };
  useEffect(() => {
    const el = root.current; if (!el) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    const onBack = () => close();
    window.addEventListener("keydown", onKey);
    el.addEventListener("cj:close", onBack);
    return () => { window.removeEventListener("keydown", onKey); el.removeEventListener("cj:close", onBack); };
  });

  const choose = (m: ClassMoment, e: React.MouseEvent<HTMLElement>) => {
    e.stopPropagation(); haptic("select");
    const pic = e.currentTarget.querySelector<HTMLElement>(".bs-gallery__pic");
    picked.current = pic ? place(pic) : null;
    onSelect(m);
  };
  const openNote = (m: ClassMoment) => {
    haptic("select");
    const back = `from=${encodeURIComponent(from)}`;
    navigate(m.url ? `${toAppPath(m.url)}?t=${m.t}&${back}` : `/watch/${encodeURIComponent(m.video)}?t=${m.t}&${back}`);
  };

  const card = (m: ClassMoment) => (
    <article key={deckKey(m)} className="bs-gallery__item" onClick={(e) => e.stopPropagation()}>
      <button type="button" className="bs-gallery__btn" aria-label={`${m.label}, at ${m.ts}`} onClick={(e) => choose(m, e)}>
        <span className="bs-gallery__pic" data-gallery-card={deckKey(m)} style={{ borderColor: c.reverse }}>
          <DeckImage video={m.video}><span className="bs-gallery__badge">{m.ts}</span></DeckImage>
        </span>
      </button>
      <div className="bs-gallery__text" style={{ animationDelay: `${delayOf(m) + 180}ms` }}>
        <b>{m.label}</b>
        <small>{[m.teacher, m.date ? fmtDate(m.date) : ""].filter(Boolean).join(" · ")}</small>
        <span>{m.verses.includes(":") ? m.verses : `${reference} · ${/[-,]/.test(m.verses) ? "verses" : "verse"} ${m.verses}`}</span>
      </div>
    </article>
  );
  const grid = (ms: ClassMoment[], center: boolean) => <div className={`bs-gallery__grid${ms.length === 1 ? " bs-gallery__grid--one" : ""}${center ? " bs-gallery__grid--center" : ""}`}>{ms.map(card)}</div>;

  return createPortal(
    <div ref={root} className="bs-gallery" data-open={shown ? "" : undefined} data-mode={mode} role="dialog" aria-modal="true" aria-label="Classes that taught this" data-sheet-open=""
      style={{ ["--deck-bg" as string]: c.reverse, ["--deck-ink" as string]: c.default, ["--deck-primary" as string]: c.primary, color: c.default }}
      onClick={close}>
      <button type="button" className="bs-gallery__close" aria-label="Close" style={{ background: c.reverse, color: c.default }} onClick={(e) => { e.stopPropagation(); close(); }}>
        <Feather name="x" size={21} color={c.default} />
      </button>
      {mode === "gallery" ? (
        <div className="bs-gallery__scroll">
          {sections?.length ? (
            <div className={`bs-gallery__sections${list.length <= 4 ? " bs-gallery__sections--center" : ""}`}>
              {sections.map((s, i) => (
                <section key={s.title}>
                  {list.length > 1 ? <h2 style={{ animationDelay: `${80 + i * 60}ms` }}>{s.title}</h2> : null}
                  {grid(s.items, false)}
                </section>
              ))}
            </div>
          ) : grid(items, items.length <= 4)}
        </div>
      ) : selected ? (
        <div className="bs-player" onClick={(e) => e.stopPropagation()}>
          <div className="bs-player__box" style={{ borderColor: c.reverse }}>
            <DeckImage video={selected.video} hidden={ready} />
            <iframe src={embed(selected.video, selected.t)} title={selected.label} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"
              onLoad={() => window.setTimeout(() => setReady(true), 220)} style={{ opacity: ready ? 1 : 0 }} />
          </div>
          <div className="bs-player__actions">
            <button type="button" style={{ background: c.reverse, color: c.default, borderColor: c.border }} onClick={() => openNote(selected)}>Class notes</button>
            <button type="button" style={{ background: c.reverse, color: c.default, borderColor: c.border }} onClick={() => { haptic("select"); openLink(youtube(selected.video, selected.t)); }}>Open in YouTube</button>
          </div>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
