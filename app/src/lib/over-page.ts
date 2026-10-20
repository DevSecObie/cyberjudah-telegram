/**
 * Pages over the workspace (Bible Strong's stack routes over `/`): a page opened from Home or the
 * menu, or further in from such a page, sits over the current tab without changing any tab, and
 * Back returns to the tab as it was. Kept by history entry; a tab switch clears its entry.
 */
const KEY = "cj:over";
// Kept for the session, as the history entries are, so a reload does not take an over page for a tab.
const over = ((): Set<number> => { try { return new Set(JSON.parse(sessionStorage.getItem(KEY) ?? "[]")); } catch { return new Set(); } })();
const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify([...over])); } catch { /* private mode */ } };
export const historyIdx = (): number => window.history.state?.idx ?? 0;
export const markOver = (idx: number) => { over.add(idx); save(); };
export const clearOver = (idx: number) => { over.delete(idx); save(); };
/** Clears the pages over the workspace ahead of an entry (the tab left owns them); returns them, to put back. */
export const clearOverAhead = (idx: number): number[] => { const ahead = [...over].filter((i) => i > idx); for (const i of ahead) over.delete(i); save(); return ahead; };
export const isOver = (idx: number) => over.has(idx);
