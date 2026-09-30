// Ask CyberJudah's allowance, the way AI features inside apps charge: a small free allowance
// each day, a monthly Telegram Stars subscription with a monthly allowance, and Stars top-up
// packs. Everything is measured in units, Claude's real token use weighted as Anthropic bills
// it (output five times input, a cache write 1.25 times, a cache read a tenth), so a deep
// question uses more than a quick follow-up. The pure part, shared by the Worker and the tests.

/** Units for one model call's usage. */
export function unitsOf(u) {
  if (!u) return 0;
  return Math.round((u.input_tokens ?? 0) + 1.25 * (u.cache_creation_input_tokens ?? 0) + 0.1 * (u.cache_read_input_tokens ?? 0) + 5 * (u.output_tokens ?? 0));
}

const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };

/**
 * Prices from the Worker's settings: what an input-equivalent million tokens costs (USD),
 * what one Star brings in (USD), and the margin over cost. From these a Star buys a number of
 * units, so every plan and pack pays for what it allows.
 */
export function pricing(env = {}) {
  const usdPerMtok = num(env.ASK_USD_PER_MTOK, 5);
  const usdPerStar = num(env.ASK_USD_PER_STAR, 0.013);
  const margin = num(env.ASK_MARGIN, 1.3);
  const unitsPerStar = (usdPerStar / (usdPerMtok / 1e6)) / margin;
  const packs = String(env.ASK_PACKS ?? "150,500,1500").split(",").map((s) => Math.round(num(s.trim(), 0))).filter(Boolean);
  return {
    usdPerMtok, usdPerStar, margin, unitsPerStar,
    freeDaily: Math.round(num(env.ASK_FREE_DAILY, 120000)),
    plan: { stars: Math.round(num(env.ASK_PLAN_STARS, 750)), units: Math.floor(num(env.ASK_PLAN_STARS, 750) * unitsPerStar + 1e-6) },
    packs: packs.map((stars) => ({ stars, units: Math.floor(stars * unitsPerStar + 1e-6) })),
  };
}

export const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

/** A fresh account: nothing used today, no plan, no credit. */
export const emptyAccount = () => ({ day: "", freeUsed: 0, plan: null, credits: 0 });

/**
 * The minimum charged for a metered answer, in units (about a third of an average answer).
 * It is reserved up front so an abandoned or failed request still pays its share of the
 * model's work; the request then settles against the exact units the answer used.
 */
export const RESERVE_UNITS = 20000;

/**
 * Reserve-then-settle metering. Reserve deducts the minimum up front and snapshots the
 * account; settle the caller charges the actual units against the snapshot with spend(),
 * so metering stays exact with no refund bookkeeping. A failed request settles for the
 * reservation: the model was still paid for.
 */
export function reserve(acct, p, now = Date.now()) {
  const a = structuredClone(acct ?? emptyAccount());
  const before = structuredClone(a);
  const take = Math.min(RESERVE_UNITS, balance(a, p, now).total);
  return { before, reserved: spend(a, take, p, now) };
}

/** What is left in each pot now; the day's free allowance starts again each UTC day. */
export function balance(acct, p, now = Date.now()) {
  const a = acct ?? emptyAccount();
  const free = Math.max(0, p.freeDaily - (a.day === today(now) ? a.freeUsed : 0));
  const planOn = !!a.plan && a.plan.until > now;
  const plan = planOn ? Math.max(0, a.plan.allowance - a.plan.used) : 0;
  const credits = Math.max(0, a.credits ?? 0);
  return { free, plan, planOn, planUntil: planOn ? a.plan.until : null, planAllowance: planOn ? a.plan.allowance : 0, credits, total: free + plan + credits };
}

/** Takes the units an answer used: from today's free allowance, then the plan, then the credit. */
export function spend(acct, units, p, now = Date.now()) {
  const a = structuredClone(acct ?? emptyAccount());
  if (a.day !== today(now)) { a.day = today(now); a.freeUsed = 0; }
  let left = Math.max(0, Math.round(units));
  const fromFree = Math.min(left, Math.max(0, p.freeDaily - a.freeUsed)); a.freeUsed += fromFree; left -= fromFree;
  if (left && a.plan && a.plan.until > now) { const fromPlan = Math.min(left, Math.max(0, a.plan.allowance - a.plan.used)); a.plan.used += fromPlan; left -= fromPlan; }
  if (left) a.credits = Math.max(0, (a.credits ?? 0) - left);
  return a;
}

/** A paid month: the allowance starts afresh until the subscription's next renewal. */
export function grantPlan(acct, p, until, now = Date.now()) {
  const a = structuredClone(acct ?? emptyAccount());
  a.plan = { until: until > now ? until : now + 30 * 86400000, allowance: p.plan.units, used: 0 };
  return a;
}

/** A top-up pack: its units added to the credit, which does not expire. */
export function grantPack(acct, stars, p) {
  const pack = p.packs.find((x) => x.stars === stars);
  if (!pack) throw new Error("No such pack");
  const a = structuredClone(acct ?? emptyAccount());
  a.credits = (a.credits ?? 0) + pack.units;
  return a;
}

/** The invoice payload names what was bought and for whom, and is checked again on payment. */
export const payloadOf = (kind, uid, stars) => `ask:${kind}:${uid}:${stars}`;
export function readPayload(s) {
  const m = /^ask:(plan|pack):(\d{1,20}):(\d{1,6})$/.exec(String(s ?? ""));
  return m ? { kind: m[1], uid: Number(m[2]), stars: Number(m[3]) } : null;
}
/** A payment is good when it is in Stars, for this person, at the catalog's price. */
export function validPayment(payload, currency, amount, p) {
  const b = readPayload(payload);
  if (!b || currency !== "XTR" || amount !== b.stars) return null;
  if (b.kind === "plan" && b.stars !== p.plan.stars) return null;
  if (b.kind === "pack" && !p.packs.some((x) => x.stars === b.stars)) return null;
  return b;
}
