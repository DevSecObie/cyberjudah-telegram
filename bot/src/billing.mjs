// Paying for Ask CyberJudah: the invoice payload and the checks on a payment, shared by the Worker
// and the tests. What a payment adds to the balance, and how the balance is spent, is
// shared/credits.mjs and src/credits.ts.

/**
 * The invoice payload names what was bought, for whom, at how many Stars, and the reader's time
 * zone when the invoice was made (so the check before Telegram takes the Stars knows whether it
 * is the Sabbath where the reader is). It is checked again on payment. "plan" is only ever seen
 * on a renewal of a monthly plan bought before plans were withdrawn.
 */
export const payloadOf = (kind, uid, stars, tz) => `ask:${kind}:${uid}:${stars}${tz && TZ.test(tz) ? `:${tz}` : ""}`;
const TZ = /^[A-Za-z][A-Za-z0-9_+/-]{0,47}$/;
export function readPayload(s) {
  const m = /^ask:(plan|pack):(\d{1,20}):(\d{1,6})(?::([A-Za-z][A-Za-z0-9_+/-]{0,47}))?$/.exec(String(s ?? ""));
  return m ? { kind: m[1], uid: Number(m[2]), stars: Number(m[3]), ...(m[4] ? { tz: m[4] } : {}) } : null;
}
/** A top-up payment is good when it is in Stars, for this person, at a price on sale (catalog: { topups: [{ stars }] }). No plan is on sale. */
export function validPayment(payload, currency, amount, catalog) {
  const b = readPayload(payload);
  if (!b || b.kind !== "pack" || currency !== "XTR" || amount !== b.stars) return null;
  if (!catalog.topups.some((x) => x.stars === b.stars)) return null;
  return b;
}

/** The preset Stars amounts offered for a donation; a giver may also name any amount within donationsConfig's bounds. */
export const SUPPORT_STARS = [50, 100, 500];
/**
 * A support (donation) payload names the giver, the Stars, and — when the invoice was made from
 * the Mini App — the giver's time zone, the same way a top-up's payload does (payloadOf above),
 * so the check before Telegram takes the Stars knows whether it is a holy day where they are. The
 * zone is absent for invoices made from a bot command, which falls back to DEFAULT_ZONE.
 */
export const supportPayloadOf = (uid, stars, tz) => `support:${uid}:${stars}${tz && TZ.test(tz) ? `:${tz}` : ""}`;
/** support:<uid>:<stars> or support:<uid>:<stars>:<tz>. */
export function readSupport(s) {
  const m = /^support:(\d{1,20}):(\d{1,6})(?::([A-Za-z][A-Za-z0-9_+/-]{0,47}))?$/.exec(String(s ?? ""));
  return m ? { uid: Number(m[1]), stars: Number(m[2]), ...(m[3] ? { tz: m[3] } : {}) } : null;
}
/**
 * Donations: on or off, the amount bounds a giver may name, the presets, and the owner's donation
 * link. DONATE_MAX_STARS is optional — left unset, a giver may name any amount Telegram itself
 * accepts; the owner can set it to cap the custom-amount field without a deploy.
 */
export function donationsConfig(env) {
  const minRaw = Math.trunc(Number(env.DONATE_MIN_STARS));
  const min = Number.isFinite(minRaw) && minRaw >= 1 ? minRaw : 1;
  const maxRaw = Math.trunc(Number(env.DONATE_MAX_STARS));
  const max = Number.isFinite(maxRaw) && maxRaw >= min ? maxRaw : null;
  return { on: env.DONATIONS_ON !== "off", min, max, presets: SUPPORT_STARS, url: typeof env.DONATION_URL === "string" && env.DONATION_URL ? env.DONATION_URL : null };
}
/** Whether this many Stars is a donation amount a giver may name, given the current bounds. */
export function donationAmountValid(stars, cfg) {
  return Number.isInteger(stars) && stars >= cfg.min && (cfg.max === null || stars <= cfg.max);
}
