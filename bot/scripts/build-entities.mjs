// Builds bot/data/entities/people.json from the app's People module (the SQLite file the iPhone
// app downloads, cyberjudah-app apps/expo/public/offline/bible_entities.cyberjudah.sqlite.zip,
// unzipped). The /bs feed then serves the same people, places and groups to the web app, which
// reads every resource online as Bible Strong's web app does. Shapes follow the app's local
// reader (strongLexiconAccess.ts hydrateEntity, toChapterEntity, loadPlaces).
//
//   node scripts/build-entities.mjs path/to/bible_entities.cyberjudah.sqlite
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) throw new Error('usage: build-entities.mjs <bible_entities.sqlite>');
const db = new DatabaseSync(file, { readOnly: true });
const meta = Object.fromEntries(db.prepare('SELECT key, value FROM EntityMeta').all().map(r => [r.key, r.value]));
const name = s => String(s).replace(/_+/g, ' ');
const category = (value, type) => String(type).toLowerCase() === 'supernatural' ? 'supernatural' : ['person', 'place', 'group'].includes(value) ? value : 'other';

const rows = db.prepare('SELECT * FROM Entities ORDER BY id').all();
const byId = new Map(rows.map(r => [r.id, r]));
const byName = new Map(rows.map(r => [r.uniqueName, r]));
const places = new Map(db.prepare('SELECT * FROM EntityPlaces').all().map(p => [p.entityId, p]));
const relations = new Map();
for (const r of db.prepare('SELECT * FROM EntityRelations').all()) {
  const target = r.toEntityId != null ? byId.get(r.toEntityId) : byName.get(r.toUniqueName.includes('|') ? r.toUniqueName.slice(r.toUniqueName.indexOf('|') + 1) : r.toUniqueName);
  const list = relations.get(r.fromEntityId) ?? [];
  list.push({ r, target });
  relations.set(r.fromEntityId, list);
}
const refs = db.prepare('SELECT entityId, book, chapter, verse FROM EntityRefs').all();
const chapterCount = new Map();
const chapters = {};
for (const ref of refs) {
  const key = `${ref.book}.${ref.chapter}`;
  (chapterCount.get(ref.entityId) ?? chapterCount.set(ref.entityId, new Set()).get(ref.entityId)).add(key);
  const at = (chapters[key] ??= {});
  (at[ref.entityId] ??= new Set()).add(ref.verse);
}
const order = { person: 0, place: 1, group: 2 };
const chapterLists = {};
for (const [key, entities] of Object.entries(chapters)) {
  chapterLists[key] = Object.entries(entities)
    .map(([id, verses]) => ({ e: byId.get(Number(id)), verses: [...verses].filter(v => Number.isInteger(v) && v > 0).sort((a, b) => a - b) }))
    .sort((a, b) => (order[a.e.category] ?? 3) - (order[b.e.category] ?? 3) || (a.e.displayName < b.e.displayName ? -1 : a.e.displayName > b.e.displayName ? 1 : a.e.id - b.e.id))
    .map(({ e, verses }) => [e.uniqueName, verses]);
}

const entities = {};
for (const e of rows) {
  const p = places.get(e.id);
  const rel = (relations.get(e.id) ?? []).sort((a, b) => (a.r.relation < b.r.relation ? -1 : a.r.relation > b.r.relation ? 1 : String(a.target?.displayName ?? '').localeCompare(String(b.target?.displayName ?? ''))));
  entities[e.uniqueName] = {
    id: e.id, uniqueName: e.uniqueName, strongCodes: [], name: name(e.displayName), category: e.category, type: e.type,
    description: e.description, shortDescription: e.shortDescription, summaryHtml: e.summaryHtml, brief: e.brief, articleHtml: e.articleHtml,
    ...(p ? { place: { name: name(p.openBibleName), area: p.area, ...(p.latitude == null ? {} : { latitude: p.latitude }), ...(p.longitude == null ? {} : { longitude: p.longitude }), ...(p.googleMapUrl ? { googleMapUrl: p.googleMapUrl } : {}), ...(p.palopenmapsUrl ? { palopenmapsUrl: p.palopenmapsUrl } : {}) } } : {}),
    relations: rel.map(({ r, target }) => ({
      relation: r.relation, certainty: r.certainty,
      ...(target ? { targetId: target.id, targetUniqueName: target.uniqueName, targetCategory: target.category, targetType: target.type } : {}),
      targetName: name(target?.displayName || r.toUniqueName),
    })),
    chapterCount: chapterCount.get(e.id)?.size ?? 0,
  };
}
const out = new URL('../data/entities/', import.meta.url);
mkdirSync(out, { recursive: true });
writeFileSync(new URL('people.json', out), JSON.stringify({ revision: meta.resourceRevision, source: meta.source, sourceCommit: meta.sourceCommit, entities, chapters: chapterLists }));
console.log(meta.resourceRevision, rows.length, 'entities', Object.keys(chapterLists).length, 'chapters');
