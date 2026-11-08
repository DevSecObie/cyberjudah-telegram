import { GrammyError } from "grammy";

export const SENDS_PER_SECOND = 25;
const INTERVAL = 1000 / SENDS_PER_SECOND;
type Clock = { now: () => number; sleep: (ms: number) => Promise<void> };
const clock: Clock = { now: () => Date.now(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) };
export type BroadcastSender = { send: <T>(request: () => Promise<T>) => Promise<T> };

/** One budget for every scheduled Telegram sender, including retries. No burst at chunk boundaries. */
export function createBroadcastSender(time: Clock = clock): BroadcastSender {
  let queue = Promise.resolve(), next = 0, blockedUntil = 0;
  const turn = () => {
    const ready = queue.then(async () => {
      // A 429 can extend the cooldown while this turn is already waiting.
      let wait: number;
      while ((wait = Math.max(next, blockedUntil) - time.now()) > 0) await time.sleep(Math.min(wait, 2_147_483_647));
      next = time.now() + INTERVAL;
    });
    queue = ready.catch(() => undefined);
    return ready;
  };
  return {
    async send<T>(request: () => Promise<T>): Promise<T> {
      for (let attempt = 0; ; attempt++) {
        await turn();
        try { return await request(); } catch (e) {
          if (!(e instanceof GrammyError) || e.error_code !== 429) throw e;
          const seconds = Number(e.parameters?.retry_after);
          const wait = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 1000;
          blockedUntil = Math.max(blockedUntil, time.now() + wait);
          // Retry once, as before. A second 429 still pauses every other queued sender.
          if (attempt >= 1) throw e;
        }
      }
    },
  };
}

export const BROADCAST_LEASE_KEY = "cron-broadcast:lease";
// Cron Workers have a 15 minute wall-time limit; keep a crashed invocation's lease just beyond it.
export const BROADCAST_LEASE_SECONDS = 16 * 60;
type Lease = { owner: string; until: number };

/** Best-effort overlap guard. KV is eventually consistent, so this is not a distributed lock. */
export async function withBroadcastLease(kv: Pick<KVNamespace, "get" | "put" | "delete">, run: () => Promise<unknown>): Promise<boolean> {
  const previous = await kv.get<Lease>(BROADCAST_LEASE_KEY, "json");
  if (previous && previous.until > Date.now()) return false;
  const owner = crypto.randomUUID();
  await kv.put(BROADCAST_LEASE_KEY, JSON.stringify({ owner, until: Date.now() + BROADCAST_LEASE_SECONDS * 1000 }), { expirationTtl: BROADCAST_LEASE_SECONDS });
  // Check ownership again before sending; a competing run may have acquired it too.
  if ((await kv.get<Lease>(BROADCAST_LEASE_KEY, "json"))?.owner !== owner) return false;
  try { await run(); } finally {
    // Never delete a replacement lease. Failure to release expires safely by TTL.
    try {
      if ((await kv.get<Lease>(BROADCAST_LEASE_KEY, "json"))?.owner === owner) await kv.delete(BROADCAST_LEASE_KEY);
    } catch { console.error(JSON.stringify({ event: "broadcast_lease_release_failed" })); }
  }
  return true;
}
