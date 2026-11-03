// The Biblical entities (people, places and groups) of CyberJudah's People module, the same file
// the iPhone app downloads, served the way Bible Strong's resource service serves its entities
// module, so the web app reads them online as it reads every other resource. Built by
// scripts/build-entities.mjs into data/entities/people.json, staged as a static asset.
import type { Ctx } from './core';
import { integer, language, missing, unavailable } from './core';

type Entity = {
  id: number; uniqueName: string; strongCodes: string[]; name: string; category: string; type: string;
  description: string; shortDescription: string; summaryHtml: string; brief: string; articleHtml: string;
  place?: { name: string; area: string; latitude?: number; longitude?: number; googleMapUrl?: string; palopenmapsUrl?: string };
  relations: Record<string, unknown>[];
  chapterCount: number;
};
type People = { revision: string; entities: Record<string, Entity>; chapters: Record<string, [string, number[]][]> };

let people: Promise<People> | undefined;
const loadPeople = (c: Ctx): Promise<People> => {
  people ??= c.env.ASSETS.fetch(new Request('https://assets.local/bs-data/entities/people.json'))
    .then(async r => { if (!r.ok) throw new Error(`people ${r.status}`); return await r.json() as People; })
    .catch(e => { people = undefined; console.error({ event: 'bs_people_failed', error: String(e) }); return unavailable(); });
  return people;
};

export const entitiesRevision = (c: Ctx) => loadPeople(c).then(p => p.revision);

const listedCategory = (e: Pick<Entity, 'category' | 'type'>) =>
  e.type.toLowerCase() === 'supernatural' ? 'supernatural' : ['person', 'place', 'group'].includes(e.category) ? e.category : 'other';

/** Whether the People module is there to serve. */
export async function entitiesAvailable(c: Ctx) {
  try { return { status: 'available' as const, revision: await entitiesRevision(c) }; } catch { return undefined; }
}

export async function entity(c: Ctx, uniqueName: string) {
  language(c, 'STRONG_LEXICON_ENTITY_NOT_FOUND', true);
  const p = await loadPeople(c);
  const found = Object.hasOwn(p.entities, uniqueName) ? p.entities[uniqueName] : undefined;
  if (!found) return missing('STRONG_LEXICON_ENTITY_NOT_FOUND');
  const { chapterCount: _count, ...dto } = found;
  return c.json({ resource: { revision: p.revision }, entity: dto });
}

export async function chapterEntities(c: Ctx, bookCode: string, chapterParam: string) {
  language(c, 'STRONG_LEXICON_ENTITY_NOT_FOUND', true);
  const chapter = integer(chapterParam, 1, 200);
  const p = await loadPeople(c);
  const key = `${bookCode}.${chapter}`;
  const rows = Object.hasOwn(p.chapters, key) ? p.chapters[key] : [];
  return c.json({
    resource: { revision: p.revision },
    entities: rows.flatMap(([uniqueName, verses]) => {
      const e = p.entities[uniqueName];
      return e ? [{ uniqueName, name: e.name, category: listedCategory(e), type: e.type, verses }] : [];
    }),
  });
}

export async function listEntities(c: Ctx) {
  language(c, 'STRONG_LEXICON_ENTITY_NOT_FOUND', true);
  const p = await loadPeople(c);
  return c.json({
    resource: { revision: p.revision },
    entities: Object.values(p.entities).map(e => ({
      uniqueName: e.uniqueName, name: e.name, category: listedCategory(e), type: e.type, brief: e.brief, chapterCount: e.chapterCount,
      ...(e.place?.latitude == null ? {} : { latitude: e.place.latitude }),
      ...(e.place?.longitude == null ? {} : { longitude: e.place.longitude }),
    })),
  });
}
