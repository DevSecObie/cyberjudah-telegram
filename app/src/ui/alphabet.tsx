import { useEffect, useRef, type ReactNode } from "react";

import { haptic } from "@/tg/sdk";

export const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

/**
 * Bible Strong's AlphabetList: a strip of letters along the bottom of a list, the chosen one
 * bold with a short bar under it. It sits above the dock and scrolls sideways, keeping the
 * chosen letter in view.
 */
export function AlphabetBar({ letter, onChange, letters = LETTERS, tone = "accent" }: { letter: string; onChange: (l: string) => void; letters?: string[]; tone?: "accent" | "gold" }) {
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = strip.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    el?.scrollIntoView?.({ block: "nearest", inline: "center" });
  }, [letter]);
  return (
    <nav className="abc" data-tone={tone} aria-label="Letters">
      <div ref={strip} className="abc__strip">
        {letters.map((l) => <button key={l} type="button" aria-pressed={l === letter} aria-label={`Letter ${l}`} onClick={() => { if (l !== letter) { haptic("select"); onChange(l); } }}>{l}<span aria-hidden="true" /></button>)}
      </div>
    </nav>
  );
}

/** Bible Strong's SectionTitle: the letter in a 30px disc, heading the rows that start with it. */
export function LetterSection({ letter, tone = "accent", children }: { letter: string; tone?: "accent" | "gold"; children: ReactNode }) {
  return (
    <section className="abc-section" aria-label={letter}>
      <h2 className="abc-section__badge" data-tone={tone}>{letter}</h2>
      {children}
    </section>
  );
}

/** Rows grouped by their first letter, in the order they come (Bible Strong's useSectionResults). */
export function byLetter<T>(rows: T[], key: (r: T) => string): { letter: string; rows: T[] }[] {
  const out: { letter: string; rows: T[] }[] = [];
  for (const r of rows) {
    const c = key(r).charAt(0).toUpperCase();
    const l = /[A-Z]/.test(c) ? c : "#";
    const last = out[out.length - 1];
    if (last?.letter === l) last.rows.push(r); else out.push({ letter: l, rows: [r] });
  }
  return out;
}
