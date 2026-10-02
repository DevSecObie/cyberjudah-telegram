/**
 * Whether, and after how long, to try a D1 import of the search index again. D1 runs one import
 * at a time; one that drops part-way ("Not currently import at bookmark …") can still be running
 * on D1's side, and the next try is refused with "Currently processing a long-running import"
 * until it finishes or times out. A single retry after 15 s failed the 2026-10-01 deploy (run
 * 36915871818) after the Worker was already live. So: wait out a busy database with growing
 * pauses (about nine minutes in all), and retry anything else once.
 */
const BUSY = /Currently processing a long-running import|Not currently import(ing)? at bookmark|Not currently importing anything/i;
export const BUSY_WAITS = [30, 60, 90, 120, 240];

/** Seconds to wait before attempt `attempt + 1`, or null to give up. `attempt` counts from 1. */
export function importRetryDelay(output, attempt) {
  if (BUSY.test(output ?? "")) return attempt <= BUSY_WAITS.length ? BUSY_WAITS[attempt - 1] : null;
  return attempt === 1 ? 15 : null;
}
