/**
 * Bible Strong's availableUpdates (features/resources): an installed resource needs an update when
 * the catalog lists another release of it. Keyed by id; the value identifies the update itself, so
 * a later release of an update already seen counts as a new one.
 */
export function getAvailableUpdates(installed, catalog) {
  const updates = new Map();
  for (const local of installed) {
    const entry = catalog?.resources.find((r) => r.id === local.id);
    if (entry && entry.release !== local.manifest.release) updates.set(local.id, entry.release);
  }
  return updates;
}

export const hasUnseenUpdates = (updates, seen) => [...updates].some(([id, update]) => seen[id] !== update);

/** Returns `seen` itself when every update was already seen, so the stored value stays stable. */
export const markUpdatesSeen = (updates, seen) =>
  hasUnseenUpdates(updates, seen) ? { ...seen, ...Object.fromEntries(updates) } : seen;
