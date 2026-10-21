/** Bible Strong 27.2.0: usePassageSearch.ts and SearchQueryInput.tsx. */
export const SEARCH_PAGE_SIZE = 20;
export const SEARCH_DEBOUNCE_MS = 800;

export class ScriptureSearchError extends Error {
  constructor(readonly status: number, readonly retryAfter: string | null) {
    super("Bible search could not be opened.");
  }
}

export function searchRateLimitSeconds(error: unknown, now = Date.now()): number | undefined {
  if (!(error instanceof ScriptureSearchError) || error.status !== 429) return undefined;
  const header = error.retryAfter?.trim();
  if (!header) return 60;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds >= 0 ? Math.max(1, Math.ceil(seconds)) : 60;
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(1, Math.ceil((date - now) / 1000)) : 60;
}

/** Retry only throttling, once, after the server's cooldown. */
export const searchRetry = {
  retry: (failureCount: number, error: unknown) => failureCount < 1 && searchRateLimitSeconds(error) !== undefined,
  retryDelay: (_failureCount: number, error: unknown) => (searchRateLimitSeconds(error) ?? 60) * 1000,
};

export type PassageHit = { book: number; chapter: number; verse: number; text: string };
export type PassagePage = { results: PassageHit[]; count: number };

/** Keep the first copy in its original position when a page repeats a verse. */
export function uniquePassages(pages: readonly PassagePage[]): PassageHit[] {
  const seen = new Set<string>();
  return pages.flatMap(page => page.results).filter(hit => {
    const key = `${hit.book}:${hit.chapter}:${hit.verse}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
