import { useSyncExternalStore } from "react";

/**
 * Bible Strong's Strong's mode (BibleTab.data.strongMode): per tab, kept with the tab, hidden
 * until chosen. Reverse interlinear needs the original-language text this library does not
 * carry, so only Text and Strong are available.
 */
export type StrongMode = "hidden" | "visible" | "reverse-interlinear";
const KEY = "cj:strong-mode";
const listeners = new Set<() => void>();
let modes: Record<string, StrongMode> = (() => {
  try { const m = JSON.parse(localStorage.getItem(KEY) ?? "null"); return m && typeof m === "object" ? m : {}; } catch { return {}; }
})();
export const strongModeOf = (tabId: string): StrongMode => modes[tabId] ?? "hidden";
export function setStrongMode(tabId: string, mode: StrongMode) {
  if (strongModeOf(tabId) === mode) return;
  const { [tabId]: _, ...rest } = modes;
  modes = mode === "hidden" ? rest : { ...rest, [tabId]: mode };
  // Match the bounded reader sessions; closed tabs cannot grow storage indefinitely.
  const ids = Object.keys(modes);
  if (ids.length > 80) delete modes[ids[0]];
  try { localStorage.setItem(KEY, JSON.stringify(modes)); } catch { /* kept for this visit only */ }
  for (const l of listeners) l();
}
export function useStrongMode(tabId: string): [StrongMode, (mode: StrongMode) => void] {
  const mode = useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => strongModeOf(tabId), () => "hidden" as StrongMode);
  return [mode, (m) => setStrongMode(tabId, m)];
}

/** Bible Strong's bibleKeyboardActions.nextAvailableStrongMode. */
export function nextAvailableStrongMode(current: StrongMode, strongAvailable: boolean, interlinearAvailable: boolean): StrongMode {
  const list: StrongMode[] = ["hidden"];
  if (strongAvailable) list.push("visible");
  if (strongAvailable && interlinearAvailable) list.push("reverse-interlinear");
  return list[(list.indexOf(current) + 1) % list.length];
}

/** A Strong's number as Bible Strong shows it: the letter and four digits (H0430, G2316). */
export const strongCode = (n: string) => /^[HG]\d+$/.test(n) ? `${n[0]}${n.slice(1).padStart(4, "0")}` : n;

/** Bible Strong's getStrongSelectionWordFromTextSegment: the segment without its edge punctuation. */
export const strongSelectionWord = (segment: string) => segment.trim().replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu, "").trim() || undefined;

/**
 * Bible Strong's canonical Strong presentation: each word keyed to Strong's numbers gets a
 * reference after it, at the end of the word (before its punctuation); the text is unchanged.
 */
export type StrongReference = { offset: number; word: string; numbers: string[]; occurrence: number };
export function strongReferences(text: string, words: [string, string[]][] | undefined): StrongReference[] {
  if (!words?.length || words.map(([w]) => w).join(" ") !== text) return [];
  const refs: StrongReference[] = [];
  let start = 0;
  words.forEach(([segment, nums], i) => {
    const numbers = [...new Set(nums)];
    if (numbers.length) {
      const end = start + segment.replace(/[\p{P}\s]+$/u, "").length;
      const word = strongSelectionWord(segment);
      if (word && end > start) refs.push({ offset: end, word, numbers, occurrence: i });
    }
    start += segment.length + 1;
  });
  return refs;
}

/** What the reader passes each verse while Strong's mode is on: the tapped reference, and the tap. */
export type StrongSelection = { verse: number; occurrence: number; word: string; numbers: string[] };
export type StrongDisplay = { selected: StrongSelection | null; onSelect: (s: StrongSelection) => void };
