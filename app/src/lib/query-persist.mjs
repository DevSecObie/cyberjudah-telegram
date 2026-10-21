/**
 * Public queries, the same for every reader, kept on the device so Home and the reader paint at
 * once on the next launch. Each key prefix keeps its newest entries up to its limit. Keys not
 * listed here (anything personal: me, notes, requests, donations…) are never written.
 */
export const PERSISTED = { books: 1, votd: 5, recent: 1, teachings: 1, shows: 1, "class-broadcasts": 1, topics: 1, precepts: 1, chapter: 40, xref: 40, cites: 40 };
export const MAX_AGE = 7 * 24 * 60 * 60_000;

export const persistable = (key) => Array.isArray(key) && Object.hasOwn(PERSISTED, key[0]);

/** Newest first; the daily verse by its day, so today's never gives way to the carousel's past days. */
const newer = (a, b) => a.queryKey[0] === "votd" && b.queryKey[0] === "votd"
  ? String(b.queryKey[1]).localeCompare(String(a.queryKey[1]))
  : b.state.dataUpdatedAt - a.state.dataUpdatedAt;

/** The listed queries within each prefix's limit, none older than MAX_AGE. */
export function trim(queries, now = Date.now()) {
  const kept = new Map();
  return [...queries].sort(newer).filter((q) => {
    if (!persistable(q.queryKey) || !(now - q.state.dataUpdatedAt <= MAX_AGE)) return false;
    const count = (kept.get(q.queryKey[0]) ?? 0) + 1;
    kept.set(q.queryKey[0], count);
    return count <= PERSISTED[q.queryKey[0]];
  });
}

/**
 * The saved copy of a query that has data: as loaded, even when its last refresh failed (the
 * data it kept is still good), and without an in-flight promise, which can't be stored.
 */
export function settle({ promise: _promise, ...query }) {
  return { ...query, state: { ...query.state, status: "success", error: null, fetchStatus: "idle", fetchFailureCount: 0, fetchFailureReason: null } };
}

/**
 * What is in memory merged into what was saved: queries the cache has let go of (out of sight
 * for a while) stay saved until trim ages them out; the newer copy of a query wins.
 */
export function merge(saved, fresh) {
  const byHash = new Map(saved.map((q) => [q.queryHash, q]));
  for (const q of fresh) {
    const old = byHash.get(q.queryHash);
    if (!old || !(old.state.dataUpdatedAt > q.state.dataUpdatedAt)) byHash.set(q.queryHash, q);
  }
  return [...byHash.values()];
}
