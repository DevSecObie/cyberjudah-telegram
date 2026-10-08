/** Donation bounds, as GET /api/donations reports them (bot/src/billing.mjs donationsConfig). */
export type DonateBounds = { minStars: number; maxStars: number | null };

/**
 * A custom amount field's text, as the whole number of Stars it names, or null when it names
 * none: empty, not a number, not a whole number, or outside the bounds the server will accept
 * (mirrors donationAmountValid in bot/src/billing.mjs, so the button disables before a bad request
 * is ever sent).
 */
export function parseDonationAmount(input: string, bounds: DonateBounds): number | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (!Number.isInteger(n)) return null;
  if (n < bounds.minStars) return null;
  if (bounds.maxStars !== null && n > bounds.maxStars) return null;
  return n;
}
