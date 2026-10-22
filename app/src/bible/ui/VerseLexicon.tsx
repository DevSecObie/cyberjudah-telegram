import { useQueries } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { data, type StrongsEntry } from "@/api/data";
import { useResourceRelease } from "@/resources/hooks";
import { ReferenceText } from "@/resources/ReferenceText";

import { Feather } from "../icons";
import { useBibleSettings } from "../settings";
import { getBibleTextFontSize, scaleLineHeight } from "../typography";
import { BibleVerseDetailFooter } from "./BibleVerseDetailFooter";

/**
 * Bible Strong's Lexicon resource for one verse (BibleVerseDetailCard): the verse, its words
 * with a Strong's number as pills (BibleStrongReference), Previous and Next verse
 * (BibleVerseDetailFooter), then a carousel of the verse's Strong's entries, one card a number
 * (StrongCard). A tapped pill brings its card; a card scrolled to selects its pill.
 */
type Occurrence = { number: string; word: string; occurrenceIndex: number };
type Run = { kind: "text"; text: string } | { kind: "strong"; word: string; targets: Occurrence[] };

const CARD_MAX_WIDTH = 250;
const CARD_MAX_HEIGHT = 600;
const GAP = 10;

/** The verse as Bible Strong's canonical runs: plain words, and words that carry Strong's numbers. */
function runsOf(words: [string, string[]][]) {
  const runs: Run[] = [];
  const occurrences: Occurrence[] = [];
  words.forEach(([text, nums], i) => {
    if (i > 0) runs.push({ kind: "text", text: " " });
    if (!nums.length) { for (const chunk of text.match(/\S+\s*|\s+/gu) ?? []) runs.push({ kind: "text", text: chunk }); return; }
    const targets = nums.map((number) => ({ number, word: text, occurrenceIndex: occurrences.length + nums.indexOf(number) }));
    occurrences.push(...targets);
    runs.push({ kind: "strong", word: text, targets });
  });
  return { runs, occurrences };
}

export function VerseLexicon({ verse, words, verses, onVerse, onOpen, onRead, children }: { verse: number; words: [string, string[]][]; verses: number; onVerse: (v: number) => void; onOpen: (number: string) => void; onRead: () => void; children?: ReactNode }) {
  const [settings] = useBibleSettings();
  const release = useResourceRelease("strongs");
  const { runs, occurrences } = runsOf(words);
  const numbers = [...new Set(occurrences.map((o) => o.number))];
  const entries = useQueries({ queries: numbers.map((n) => ({ queryKey: ["strongs", n, release], enabled: release !== undefined, queryFn: () => data.strongs(n, release), staleTime: Infinity })) });
  const byNumber = new Map(numbers.map((n, i) => [n, entries[i]?.data] as const));
  const cards = occurrences.flatMap((o) => { const entry = byNumber.get(o.number); return entry ? [{ entry, o }] : []; });
  const pending = entries.some((q) => q.isPending);
  const failed = entries.find((q) => q.isError);

  const box = useRef<HTMLDivElement>(null);
  const verseScroll = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [current, setCurrent] = useState(0);
  const currentRef = useRef(0);
  const programmatic = useRef(false);
  useLayoutEffect(() => {
    const el = box.current; if (!el) return;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const itemWidth = Math.max(1, Math.min(CARD_MAX_WIDTH, size.width - 40));
  const step = itemWidth + GAP;

  // A new verse starts at its first card, the verse scrolled to its top.
  useEffect(() => {
    currentRef.current = 0; programmatic.current = false; setCurrent(0);
    verseScroll.current?.scrollTo({ top: 0 });
    strip.current?.scrollTo({ left: 0 });
  }, [verse]);

  const scrollToCard = (occurrenceIndex: number) => {
    const index = cards.findIndex((c) => c.o.occurrenceIndex === occurrenceIndex);
    if (index === -1) return;
    programmatic.current = true;
    strip.current?.scrollTo({ left: index * step, behavior: "smooth" });
    currentRef.current = index; setCurrent(index);
  };
  const scrollVerseTo = (occurrenceIndex: number) => {
    const pill = verseScroll.current?.querySelector<HTMLElement>(`[data-occurrence~="${occurrenceIndex}"]`);
    if (pill && verseScroll.current) verseScroll.current.scrollTo({ top: pill.offsetTop, behavior: "smooth" });
  };
  const onStripScroll = () => {
    if (programmatic.current || !strip.current) return;
    const index = Math.min(Math.max(0, Math.round(strip.current.scrollLeft / step)), Math.max(0, cards.length - 1));
    if (index === currentRef.current) return;
    currentRef.current = index; setCurrent(index);
    const o = cards[index]?.o; if (o) scrollVerseTo(o.occurrenceIndex);
  };
  const selected = cards[current]?.o.occurrenceIndex;
  const textStyle = { fontSize: getBibleTextFontSize(false, settings.fontSizeScale), lineHeight: scaleLineHeight(24, settings.lineHeight, settings.fontSizeScale) };

  return (
    <div ref={box} className="bs-vdetail" data-testid="resource-modal-content">
      <div className="bs-vdetail__top">
        <div ref={verseScroll} className="bs-vdetail__scroll" data-testid="resource-verse-scroll" style={size.height ? { maxHeight: size.height * 0.4 } : undefined}>
          <div className="bs-vdetail__verse">
            <div className="bs-vdetail__num"><span>{verse}</span></div>
            <div className="bs-vdetail__text" data-testid="resource-verse-text">
              {runs.map((r, i) => r.kind === "text"
                ? <span key={i} className="bs-vdetail__chunk" style={textStyle}>{r.text}</span>
                : <button key={i} type="button" className="bs-strongref" aria-label={r.word} aria-pressed={r.targets.some((t) => t.occurrenceIndex === selected)} data-occurrence={r.targets.map((t) => t.occurrenceIndex).join(" ")} onClick={() => scrollToCard(r.targets[0].occurrenceIndex)}><span style={textStyle}>{r.word}</span></button>)}
            </div>
          </div>
          {children}
        </div>
        <BibleVerseDetailFooter verse={verse} verses={verses} onVerse={onVerse} />
      </div>
      <div className="bs-vdetail__corner"><div /></div>
      <div className="bs-vdetail__cards">
        {failed ? <p className="bs-loading" role="status">This did not load. <button type="button" className="bs-link" onClick={() => void failed.refetch()}>Retry</button></p>
          : pending && numbers.length ? <p className="bs-loading">Loading...</p>
          : <div ref={strip} className="bs-vdetail__strip" style={{ scrollSnapType: "x mandatory" }} onScroll={onStripScroll}
              onPointerDown={() => { programmatic.current = false; }} onTouchStart={() => { programmatic.current = false; }} onWheel={() => { programmatic.current = false; }}
              onScrollEnd={() => { programmatic.current = false; }}>
              {cards.map(({ entry, o }) => (
                <div key={`${o.number}:${o.occurrenceIndex}`} className="bs-vdetail__item" data-testid="resource-strong-carousel-card" style={{ width: itemWidth, maxHeight: CARD_MAX_HEIGHT }}>
                  <StrongCard entry={entry} word={o.word} onOpen={() => onOpen(entry.number)} onRead={onRead} />
                </div>
              ))}
            </div>}
      </div>
    </div>
  );
}

/** Bible Strong's StrongCard: the number, the word, its transliteration, pronunciation and original, then the definition. */
function StrongCard({ entry, word, onOpen, onRead }: { entry: StrongsEntry; word: string; onOpen: () => void; onRead: () => void }) {
  const line = [entry.xlit, entry.pron, entry.lemma].filter(Boolean).join(" · ");
  return (
    <div className="bs-strongcard">
      <div className="bs-strongcard__head">
        <button type="button" className="bs-strongcard__open" aria-label={`${entry.number} · ${word}`} onClick={onOpen}>
          <span className="bs-strongcard__code">{entry.number}</span>
          <span className="bs-strongcard__gloss">{word}</span>
          {line ? <span className="bs-strongcard__line">{line}</span> : null}
        </button>
        <span className="bs-strongcard__border" />
      </div>
      <div className="bs-strongcard__body">
        <div className="bs-strongcard__def">
          {entry.def ? <p><ReferenceText text={entry.def} links={entry.scripture?.def} onRead={onRead} /></p> : null}
          {entry.derivation ? <p><ReferenceText text={entry.derivation} links={entry.scripture?.derivation} onRead={onRead} /></p> : null}
          {entry.kjv ? <p><b>KJV:</b> <ReferenceText text={entry.kjv} links={entry.scripture?.kjv} onRead={onRead} /></p> : null}
        </div>
      </div>
    </div>
  );
}
