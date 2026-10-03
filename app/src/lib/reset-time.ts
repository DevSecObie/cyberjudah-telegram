/** When Ask's free daily credits come back (each UTC day, shared/credits.mjs endOfDay), in the reader's own time. */
export function resetTime(now = new Date(), locale?: string, timeZone?: string): string {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return next.toLocaleTimeString(locale ?? [], { hour: "numeric", minute: "2-digit", ...(timeZone ? { timeZone } : {}) });
}
