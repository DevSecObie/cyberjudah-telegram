/**
 * Public queries, the same for every reader, kept on the device so Home and the reader paint at
 * once on the next launch. Each key prefix keeps its newest entries up to its limit. Keys not
 * listed here (anything personal: me, notes, requests, donations…) are never written.
 */
export const PERSISTED = { books: 1, votd: 2, recent: 1, teachings: 1, shows: 1, "class-broadcasts": 1, topics: 1, precepts: 1, chapter: 40, xref: 40, cites: 40 };
export const MAX_AGE = 7 * 24 * 60 * 60_000;

export const persistable = (key) => Array.isArray(key) && Object.hasOwn(PERSISTED, key[0]);

/** The listed queries within each prefix's limit, newest first, none older than MAX_AGE. */
export function trim(queries, now = Date.now()) {
  const kept = new Map();
  return [...queries].sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt).filter((q) => {
    if (!persistable(q.queryKey) || !(now - q.state.dataUpdatedAt <= MAX_AGE)) return false;
    const count = (kept.get(q.queryKey[0]) ?? 0) + 1;
    kept.set(q.queryKey[0], count);
    return count <= PERSISTED[q.queryKey[0]];
  });
}
