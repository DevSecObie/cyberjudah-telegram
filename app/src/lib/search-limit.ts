/**
 * The sentence the Search AI answer shows when the server refuses it with 429 (#606):
 * "limit" (the reader's or the address's allowance) or "free-paused" (the shared free budget).
 * Retry-After, when sent, says how long to wait. Any other status or reason gets no sentence.
 */
export function searchLimitMessage(status: number, error?: string, retryAfter?: string | null, now = Date.now()): string | undefined {
  if (status !== 429) return undefined;
  if (error === "free-paused") return "Free answers have reached their shared daily budget. Try again later.";
  if (error !== "limit") return undefined;
  const wait = retrySeconds(retryAfter, now);
  return `You've reached today's search limit. Try again ${wait === undefined ? "later" : `in ${waitText(wait)}`}.`;
}

/** Retry-After as seconds: a delay in seconds or an HTTP date; anything else is undefined. */
export function retrySeconds(value: string | null | undefined, now = Date.now()): number | undefined {
  const v = value?.trim();
  if (!v) return undefined;
  if (/^\d+$/.test(v)) return Math.max(1, Number(v));
  if (!/[a-z]/i.test(v)) return undefined; // not a delay and not an HTTP date ("-2" would parse as a year)
  const at = Date.parse(v);
  return Number.isNaN(at) ? undefined : Math.max(1, Math.ceil((at - now) / 1000));
}

function waitText(s: number): string {
  if (s <= 60) return "a minute";
  if (s < 3600) return `${Math.ceil(s / 60)} minutes`;
  const h = Math.ceil(s / 3600);
  return h === 1 ? "an hour" : `about ${h} hours`;
}
