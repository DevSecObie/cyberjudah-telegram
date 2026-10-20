/**
 * Pages over the workspace (Bible Strong's stack routes over `/`): a page opened from Home or the
 * menu, or further in from such a page, sits over the current tab without changing any tab, and
 * Back returns to the tab as it was. Kept by history entry; a tab switch clears its entry.
 */
const over = new Set<number>();
export const historyIdx = (): number => window.history.state?.idx ?? 0;
export const markOver = (idx: number) => { over.add(idx); };
export const clearOver = (idx: number) => { over.delete(idx); };
export const isOver = (idx: number) => over.has(idx);
