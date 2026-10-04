import { APPROVED_RESOURCE_IDS, ResourcePinsSchema, type ResourcePins } from '../../shared/resources';
import type { Env } from './env';
import { readCatalog, readResourceRecord, readResourceManifest } from './resources';

export async function resolveResourcePins(env: Pick<Env, 'AUDIO'>, requested?: ResourcePins): Promise<ResourcePins> {
  const input = ResourcePinsSchema.parse(requested ?? {});
  if (APPROVED_RESOURCE_IDS.every((id) => id in input)) return input;
  const catalog = env.AUDIO ? (await readCatalog(env)).catalog : null;
  return Object.fromEntries(APPROVED_RESOURCE_IDS.map((id) => [id, id in input ? input[id] : catalog?.resources.find((r) => r.id === id)?.release ?? null]));
}
export async function pinnedRecord<T>(env: Env, pins: ResourcePins, id: keyof ResourcePins, key: string): Promise<T | null> {
  const release = pins[id];
  if (!release) return null;
  const record = await readResourceRecord(env, id, key, release);
  if (!record || record.release !== release) throw new Error('The selected resource release is unavailable');
  return record.data as T;
}
export const resourceLink = (id: string, release: string, key: string) => `/resources/${id}/${release}?key=${encodeURIComponent(key)}`;
export type ResourcePage = { title: string; text: string; scan: string; volume: number; page: number };
const terms = (query: string) => [...new Set(query.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').match(/[a-z]{3,40}/g) ?? [])].slice(0, 4);
/** At most four bounded postings and five page reads, all from the caller's snapshot. */
export async function resourcePages(env: Env, pins: ResourcePins, id: keyof ResourcePins, query: string, key?: string) {
  if (!pins[id]) return [];
  if (key) {
    if (!/^page\/\d+\/\d+$/.test(key)) throw new Error('Use a page key from this resource');
    const data = await pinnedRecord<ResourcePage>(env, pins, id, key);
    return data ? [{ key, data }] : [];
  }
  if (!await readResourceManifest(env, id, pins[id]!)) throw new Error("The selected resource release is unavailable");
  const words = terms(query);
  if (!words.length) return [];
  const postings: { keys: string[]; total: number }[] = [];
  for (const word of words) {
    // A missing search term is normal; a missing approved release is not.
    const record = await readResourceRecord(env, id, `search/${word}`, pins[id]!);
    if (record) postings.push(record.data as { keys: string[]; total: number });
  }
  const keys = postings.sort((a, b) => a.total - b.total)[0]?.keys.slice(0, 5) ?? [];
  const found = [];
  for (const key of keys) { const data = await pinnedRecord<ResourcePage>(env, pins, id, key); if (data) found.push({ key, data }); }
  return found;
}

// Only these exact approved printings are redirected from outside-source URLs.
const ARCHIVE_EDITIONS: Record<string, [keyof ResourcePins, number]> = {
  completeworksoff05jose: ['josephus', 1],
  cu31924091768188: ['jewish-encyclopedia', 1], cu31924091768196: ['jewish-encyclopedia', 2], jewishencycloped0003isid: ['jewish-encyclopedia', 3], cu31924091768212: ['jewish-encyclopedia', 4],
  cu31924091768220: ['jewish-encyclopedia', 5], cu31924091768238: ['jewish-encyclopedia', 6], cu31924091768246: ['jewish-encyclopedia', 7], cu31924091768253: ['jewish-encyclopedia', 8],
  cu31924091768261: ['jewish-encyclopedia', 9], cu31924091768279: ['jewish-encyclopedia', 10], jewishencycloped0011isid: ['jewish-encyclopedia', 11], cu31924091768295: ['jewish-encyclopedia', 12],
  '1889dictionaryofb01smituoft': ['smiths-dictionary-of-the-bible', 1], '1889dictionaryofb02smituoft': ['smiths-dictionary-of-the-bible', 2], '1889dictionaryofb03smituoft': ['smiths-dictionary-of-the-bible', 3], '1889dictionaryofb04smituoft': ['smiths-dictionary-of-the-bible', 4],
};
export function approvedEditionUrl(value: string): { id: keyof ResourcePins; key?: string } | null {
  let url: URL; try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || !['archive.org', 'www.archive.org'].includes(url.hostname)) return null;
  const match = /^\/(?:details|download)\/([^/]+)(?:\/page\/n(\d+))?/.exec(url.pathname);
  const edition = match && ARCHIVE_EDITIONS[match[1]];
  return edition ? { id: edition[0], ...(match[2] ? { key: `page/${edition[1]}/${match[2]}` } : {}) } : null;
}
