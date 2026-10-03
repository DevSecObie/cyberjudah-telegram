// Paying for Ask CyberJudah: the invoice payload and the checks on a payment, shared by the Worker
// and the tests. What a payment gives, and how credits are spent, is shared/credits.mjs and
// src/credits.ts.

/** The invoice payload names what was bought and for whom, and is checked again on payment. */
export const payloadOf = (kind, uid, stars) => `ask:${kind}:${uid}:${stars}`;
export function readPayload(s) {
  const m = /^ask:(plan|pack):(\d{1,20}):(\d{1,6})$/.exec(String(s ?? ""));
  return m ? { kind: m[1], uid: Number(m[2]), stars: Number(m[3]) } : null;
}
/** A payment is good when it is in Stars, for this person, at a price on sale (catalog: { plan: { stars }, packs: [{ stars }] }). */
export function validPayment(payload, currency, amount, catalog) {
  const b = readPayload(payload);
  if (!b || currency !== "XTR" || amount !== b.stars) return null;
  if (b.kind === "plan" && b.stars !== catalog.plan.stars) return null;
  if (b.kind === "pack" && !catalog.packs.some((x) => x.stars === b.stars)) return null;
  return b;
}

/** The Stars amounts a support invoice may be made for. */
export const SUPPORT_STARS = [50, 100, 500];
/** A support payload names the giver and the Stars: support:<uid>:<stars>. */
export function readSupport(s) {
  const m = /^support:(\d{1,20}):(\d{1,6})$/.exec(String(s ?? ""));
  return m ? { uid: Number(m[1]), stars: Number(m[2]) } : null;
}
