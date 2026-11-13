/**
 * The corpus release marks' format, shared by the scripts that write them (scripts/corpus-mark.mjs)
 * and the Worker that reads them (src/ask-versions.ts): one prefix per kind.
 */
export const MARK_PREFIX = { library: "lib", index: "idx" };
const BODY = /^[A-Za-z0-9-]{1,40}$/;

/** Whether `id` is a well-formed mark of `kind` ("library" → "lib-…", "index" → "idx-…"). */
export function isCorpusMark(kind, id) {
  const prefix = MARK_PREFIX[kind];
  return typeof prefix === "string" && typeof id === "string" && id.startsWith(`${prefix}-`) && BODY.test(id.slice(prefix.length + 1));
}
