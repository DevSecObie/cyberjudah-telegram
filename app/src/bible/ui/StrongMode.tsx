import { useQueries } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { data, type Book } from "@/api/data";
import { useResourceRelease } from "@/resources/hooks";

import { Feather } from "../icons";
import { nextAvailableStrongMode, strongCode, type StrongMode, type StrongSelection } from "../strongMode";
import { Sheet } from "./Sheet";
import { WordSheet } from "./WordSheet";
import "./strong-mode.css";

/** Bible Strong's StrongMark: a bold serif "S", in the accent while the numbers show. */
export function StrongMark({ highlighted }: { highlighted: boolean }) {
  return <span className="bs-strongmark" data-highlighted={highlighted ? "" : undefined} aria-hidden="true">S</span>;
}

/** Bible Strong's BibleDisplayModeCard, in its list layout: the radio, the label and what it shows, a preview on the right. */
function ModeCard({ label, description, selected, disabled, onPress, children }: { label: string; description: string; selected: boolean; disabled?: boolean; onPress: () => void; children: ReactNode }) {
  return (
    <button type="button" role="radio" aria-checked={selected} aria-disabled={disabled || undefined} aria-label={`${label}. ${description}`} className="bs-modecard" data-disabled={disabled ? "" : undefined} onClick={() => { if (!disabled) onPress(); }}>
      <span className="bs-radio" data-selected={selected ? "" : undefined}>{selected ? <span /> : null}</span>
      <span className="bs-modecard__text"><b data-selected={selected ? "" : undefined}>{label}</b><small>{description}</small></span>
      <span className="bs-modecard__preview">{children}</span>
    </button>
  );
}

/**
 * Bible Strong's StrongModeSelectorSheet: "Text display", the three mode cards. Choosing one sets
 * the tab's mode and closes it. Reverse interlinear stays disabled: this library has no
 * original-language text to show under the translation.
 */
export function StrongModeSheet({ open, onClose, mode, onMode, hebrew }: { open: boolean; onClose: () => void; mode: StrongMode; onMode: (m: StrongMode) => void; hebrew: boolean }) {
  const select = (m: StrongMode) => { onMode(m); onClose(); };
  return (
    <Sheet open={open} onClose={onClose} title="Text display" label="Text display" className="bs-strongmode-sheet">
      <div className="bs-modes" role="radiogroup" aria-label="Text display">
        <ModeCard label="Text" description="Translation only" selected={mode === "hidden"} onPress={() => select("hidden")}>
          <span className="bs-modecard__word">God</span>
        </ModeCard>
        <ModeCard label="Strong" description="Text + numbers" selected={mode === "visible"} onPress={() => select("visible")}>
          <span className="bs-modecard__strong"><span className="bs-modecard__word">God</span><span className="bs-modecard__code">{hebrew ? "H0430" : "G2316"}</span></span>
        </ModeCard>
        <ModeCard label="Reverse interlinear" description="Translation then original" selected={mode === "reverse-interlinear"} disabled onPress={() => select("reverse-interlinear")}>
          <span className="bs-modecard__interlinear"><b>God</b><span className="bs-modecard__original">{hebrew ? "אֱלֹהִים" : "θεός"}</span><small>{hebrew ? "Elohim · HNcmpa · H0430" : "theos · GNcmsn · G2316"}</small></span>
        </ModeCard>
      </div>
    </Sheet>
  );
}

/** Bible Strong's useBibleKeyboardShortcut("s"): the reader on screen cycles the modes it has. */
const editing = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || !!target.closest('input,textarea,select,[role="textbox"]'));
export function useStrongModeShortcut(root: React.RefObject<HTMLElement | null>, mode: StrongMode, onMode: (m: StrongMode) => void) {
  const current = useRef({ mode, onMode });
  current.current = { mode, onMode };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = root.current;
      if (!el || !el.getClientRects().length || el.closest('[inert], [hidden], [aria-hidden="true"]')) return;
      if (e.key.toLowerCase() !== "s" || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.repeat || e.isComposing || e.defaultPrevented || editing(e.target)) return;
      if ([...document.querySelectorAll('[data-sheet-open], [role="dialog"], [role="alertdialog"], [role="menu"], [aria-modal="true"]')].some(d => d.getAttribute("aria-modal") !== "false" && !d.closest('[inert], [aria-hidden="true"]'))) return;
      e.preventDefault(); e.stopPropagation();
      current.current.onMode(nextAvailableStrongMode(current.current.mode, true, false));
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [root]);
}

const CAROUSEL_GAP = 12;
const CAROUSEL_PADDING = 20;
/** trunc-html's 360 characters, on our plain-text definitions. */
const truncate = (text: string, n = 360) => text.length > n ? `${text.slice(0, n)}…` : text;

/**
 * Bible Strong's StrongSelectionSheet: a tapped reference opens a sheet without a backdrop,
 * "<word> · KJV", its numbers as pills and a card for each (the tapped one first); a card opens
 * the full entry. Pills and cards follow each other.
 */
export function StrongSelectionSheet({ selection, onClose, books, here }: { selection: StrongSelection | null; onClose: () => void; books: Book[]; here: { slug: string; chapter: number } }) {
  const [shown, setShown] = useState(selection);
  useEffect(() => { if (selection) setShown(selection); }, [selection]);
  const [entry, setEntry] = useState<string | null>(null);
  const release = useResourceRelease("strongs");
  const numbers = shown?.numbers ?? [];
  const queries = useQueries({ queries: numbers.map((n) => ({ queryKey: ["strongs", n, release], enabled: release !== undefined, queryFn: () => data.strongs(n, release), staleTime: Infinity })) });
  const pending = queries.some((q) => q.isPending);
  const failed = queries.find((q) => q.isError);
  const pager = useRef<HTMLDivElement>(null);
  const programmatic = useRef(false);
  const [index, setIndex] = useState(0);
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => { const on = () => setWidth(window.innerWidth); window.addEventListener("resize", on); return () => window.removeEventListener("resize", on); }, []);
  const key = numbers.join("|");
  useEffect(() => { setIndex(0); pager.current?.scrollTo({ left: 0 }); }, [key]);
  const multiple = numbers.length > 1;
  const previewWidth = width - CAROUSEL_PADDING * 2 - (multiple ? 24 : 0);
  const step = previewWidth + CAROUSEL_GAP;
  const select = (i: number) => { programmatic.current = true; setIndex(i); pager.current?.scrollTo({ left: step * i, behavior: "smooth" }); };
  const sync = () => { if (programmatic.current || !pager.current) return; setIndex(Math.max(0, Math.min(Math.round(pager.current.scrollLeft / step), numbers.length - 1))); };
  return (
    <>
      <Sheet open={!!selection} onClose={onClose} backdrop={false} title={shown ? `${shown.word} · KJV` : "Strong · KJV"} label={shown ? `${shown.word} · KJV` : "Strong"} className="bs-strongsel">
        <div className="bs-strongsel__body">
          {failed ? <p className="bs-loading" role="status">This did not load. <button type="button" className="bs-link" onClick={() => void failed.refetch()}>Retry</button></p>
            : pending ? (
              <div className="bs-strongsel__skeleton" aria-busy="true">
                <div className="bs-strongsel__pills"><span style={{ width: 68 }} /><span style={{ width: 62 }} /></div>
                <div className="bs-strongsel__skelcards"><span style={{ width: width - CAROUSEL_PADDING * 2 - 24 }} /><span style={{ width: width - CAROUSEL_PADDING * 2 - 24 }} /></div>
              </div>
            ) : !numbers.length ? <p className="bs-strongsel__none">No lexical entry found</p> : (
              <>
                <div className="bs-strongsel__pills" role="tablist" aria-label="Strong's numbers">
                  {numbers.map((n, i) => <button key={n} type="button" role="tab" aria-selected={index === i} className="bs-strongsel__pill" onClick={() => select(i)}>{strongCode(n)}</button>)}
                </div>
                <div ref={pager} className="bs-strongsel__pager" data-multiple={multiple ? "" : undefined} onScroll={sync}
                  onPointerDown={() => { programmatic.current = false; }} onTouchStart={() => { programmatic.current = false; }} onWheel={() => { programmatic.current = false; }} onScrollEnd={() => { programmatic.current = false; sync(); }}>
                  {queries.map((q, i) => {
                    const e = q.data; if (!e) return null;
                    const gloss = e.words?.[0]?.word ?? shown?.word ?? "";
                    return (
                      <button key={numbers[i]} type="button" className="bs-strongsel__card" style={{ width: previewWidth }} aria-label={`${strongCode(e.number)} · ${gloss}`} onClick={() => { setEntry(e.number); onClose(); }}>
                        <span className="bs-strongsel__head">
                          <span className="bs-strongsel__titles">
                            <b>{gloss}</b>
                            <span className="bs-strongsel__original"><span>{e.lemma}</span>{e.xlit ? <small>{e.xlit}</small> : null}</span>
                          </span>
                          <Feather name="chevron-right" size={18} color="var(--bs-tertiary)" />
                        </span>
                        {e.def ? <span className="bs-strongsel__fade"><span className="bs-strongsel__def">{truncate(e.def)}</span></span> : null}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
        </div>
      </Sheet>
      {entry ? <WordSheet number={entry} open onClose={() => setEntry(null)} books={books} here={shown ? { ...here, verse: shown.verse } : undefined} /> : null}
    </>
  );
}
