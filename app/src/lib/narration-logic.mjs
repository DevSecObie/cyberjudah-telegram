/**
 * Pure narration-completeness and retry-hint logic (CYB-123), kept free of the Cache API and
 * of React so it can be unit tested directly, the same way audio-intent.mjs is: the Cache-API
 * wrapper in narration.ts gathers the two plain inputs below and hands them to these functions.
 */

/** @typedef {"none" | "partial" | "complete"} NarrationStatus */

/**
 * @param {string[]} required every media URL the book's chapters call for
 * @param {Set<string>} cached which of those URLs are actually in the offline cache
 * @returns {NarrationStatus}
 */
export function narrationStatusFrom(required, cached) {
  // No chapter has any licensed/generated audio at all: that is not the same as having
  // downloaded everything that exists, so this must not read as "complete" (CYB-123 review).
  if (required.length === 0) return "none";
  const have = required.filter((u) => cached.has(u)).length;
  if (have === 0) return "none";
  return have === required.length ? "complete" : "partial";
}

/**
 * The size to show before downloading, or a plain explanation when it can't be known.
 * @param {number | null} bytes
 * @param {boolean} catalogFailed
 * @returns {string}
 */
export function narrationHint(bytes, catalogFailed) {
  if (catalogFailed) return "Size unknown — the narration catalog is unavailable right now.";
  if (!bytes) return "No licensed narration for this book.";
  return `≈ ${(bytes / 1_000_000).toFixed(1)} MB`;
}
