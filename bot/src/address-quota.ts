import type { Env } from "./env";
import { takeQuotaKey } from "./ai";
import { addressBlock, clientAddress } from "./client-ip";
import { keyedHash } from "./privacy.mjs";

/** A per-address allowance: a reader's own signed address by the UTC day; an unsigned one, which may
 *  be the Mini App relay shared by every reader, by the minute only, so it is never shut for the day. */
export type AddressLimits = { signedPerDay: number; unsignedPerMinute: number };
/**
 * Takes one from this request's address allowance under `prefix` (rate_counts, a keyed hash of the
 * address's block, never the address). Returns 0 when allowed, else the seconds to wait (a
 * Retry-After value). No address, no check. Call it after the reader's own allowance, so a reader
 * already refused spends nothing of the address's, and one reader cannot use it up for everyone.
 */
export async function takeAddressQuota(req: Request, env: Env, prefix: string, limits: AddressLimits, now = Date.now()): Promise<number> {
  const { ip, signed } = await clientAddress(req, env);
  if (!ip) return 0;
  const address = await keyedHash(env, prefix.replace(/_/g, "-"), addressBlock(ip)), day = new Date(now).toISOString().slice(0, 10);
  if (signed) return (await takeQuotaKey(env, `${prefix}:${address}:${day}`, limits.signedPerDay)) ? 0 : Math.ceil((Date.parse(`${day}T00:00:00Z`) + 86400_000 - now) / 1000);
  return (await takeQuotaKey(env, `${prefix}:${address}:${Math.floor(now / 60000)}:${day}`, limits.unsignedPerMinute)) ? 0 : 60 - Math.floor((now % 60000) / 1000);
}
