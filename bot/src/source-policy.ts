import type { Env } from "./env";
import configured from "../data/ask-sources.json";
export const DEFAULT_SOURCES = ["israelunite.org", "wikipedia.org", "archive.org", "gutenberg.org", "loc.gov", "archives.gov", "nps.gov", "si.edu", "blackpast.org", "slavevoyages.org", "jewishencyclopedia.com", "sacred-texts.com", "ccel.org"];
export const HOST = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
export type SourceRevision = { revision: number; hosts: string[] };
export function validSourceRevision(value: unknown): value is SourceRevision {
  if (!value || typeof value !== 'object') return false;
  const v = value as SourceRevision;
  return Number.isSafeInteger(v.revision) && v.revision >= 0 && Array.isArray(v.hosts) && v.hosts.length <= 100 && v.hosts.every(h => typeof h === 'string' && HOST.test(h)) && new Set(v.hosts).size === v.hosts.length;
}
export function selectSources(bundle: SourceRevision, kv: unknown): string[] {
  if (validSourceRevision(kv) && kv.revision > bundle.revision) return kv.hosts;
  if (bundle.revision > 0) return bundle.hosts;
  // The old unversioned list is migration input only, never an override of a reviewed revision.
  return Array.isArray(kv) && kv.every(h => typeof h === 'string' && HOST.test(h)) ? kv : DEFAULT_SOURCES;
}
export async function approvedSources(env: Env): Promise<string[]> {
  return selectSources(configured, await env.SUBS.get('ask:sources', 'json').catch(() => null));
}
