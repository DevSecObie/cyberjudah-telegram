import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export const ALPHABET = "abcdefghijklmnopqrstuvwxyz".split("");
const ITEM = 36;

/**
 * Bible Strong's AlphabetList: the letters on a centred carousel under a line, the chosen one in
 * bold at full size and the others at three quarters, a 30 by 8 bar in the list's colour under
 * the centre. A tap brings a letter to the centre; a swipe chooses the letter it stops on.
 */
export function AlphabetList({ letter, setLetter, color = "var(--accent)" }: { letter: string; setLetter: (l: string) => void; color?: string }) {
  const track = useRef<HTMLDivElement>(null);
  const index = Math.max(0, ALPHABET.indexOf(letter.toLowerCase()));
  const settle = useRef(0);
  const programmatic = useRef(false);
  const first = useRef(true);
  // A scroll settles after the page may have changed (a letter tapped, a filter chosen): it reads the letter and setter as they are then.
  const latest = useRef({ letter, setLetter });
  latest.current = { letter, setLetter };
  useLayoutEffect(() => {
    // A letter chosen outright (a tap) replaces a scroll still settling.
    window.clearTimeout(settle.current);
    const el = track.current; if (!el) return;
    const left = index * ITEM;
    if (Math.abs(el.scrollLeft - left) < 1) return;
    programmatic.current = true;
    el.scrollTo({ left, behavior: first.current ? "instant" : "smooth" });
    first.current = false;
    window.setTimeout(() => { programmatic.current = false; }, 250);
  }, [index]);
  useEffect(() => () => window.clearTimeout(settle.current), []);
  const onScroll = () => {
    if (programmatic.current) return;
    window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => {
      const el = track.current; if (!el) return;
      const at = Math.min(ALPHABET.length - 1, Math.max(0, Math.round(el.scrollLeft / ITEM)));
      if (ALPHABET[at] !== latest.current.letter) latest.current.setLetter(ALPHABET[at]);
    }, 120);
  };
  return (
    <div className="bs-alpha">
      <div ref={track} className="bs-alpha__track" role="radiogroup" aria-label="Letters" onScroll={onScroll}>
        {ALPHABET.map((l) => (
          <button key={l} type="button" role="radio" aria-checked={l === letter} aria-label={l.toUpperCase()} className="bs-alpha__letter" onClick={() => setLetter(l)}>{l.toUpperCase()}</button>
        ))}
      </div>
      <span className="bs-alpha__bar" style={{ background: color }} />
    </div>
  );
}

/**
 * Bible Strong's SectionTitle: the letter, 16 px bold on a 30 px disc in the list's colour, held at
 * the top of its section. The letter is in the page colour, or white on the Nave lists.
 */
export function SectionTitle({ color, ink, children }: { color: string; ink?: string; children: ReactNode }) {
  return <div className="bs-section"><span style={{ background: color, color: ink }}>{children}</span></div>;
}

/** The first letter a list files a word under, without its accents ("ʼâb" under A). */
export const firstLetter = (s: string) => (s.normalize("NFD").replace(/[^a-z]/gi, "")[0] ?? "#").toLowerCase();

/** Rows grouped under their first letter, in the order they come (Bible Strong's useSectionResults). */
export function sections<T>(rows: T[], word: (row: T) => string) {
  const out: { title: string; data: T[] }[] = [];
  for (const row of rows) {
    const title = firstLetter(word(row));
    const last = out.find((s) => s.title === title);
    if (last) last.data.push(row); else out.push({ title, data: [row] });
  }
  return out;
}

/** The sticky section titles sit under the page's own sticky header, whatever its height. */
export function useHeaderOffset() {
  const [top, setTop] = useState(0);
  useLayoutEffect(() => {
    const head = document.querySelector<HTMLElement>(".screen > .head");
    if (!head) return;
    const measure = () => setTop(head.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure); ro.observe(head);
    return () => ro.disconnect();
  }, []);
  return top;
}
