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

/** The Stars amounts a support invoice may be made for. */
export const SUPPORT_STARS = [50, 100, 500];
/** A support payload names the giver and the Stars: support:<uid>:<stars>. */
export function readSupport(s) {
  const m = /^support:(\d{1,20}):(\d{1,6})$/.exec(String(s ?? ""));
  return m ? { uid: Number(m[1]), stars: Number(m[2]) } : null;
}
