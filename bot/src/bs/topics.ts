import { Hono } from 'hono';
import { type App, type Ctx, type Topic, type TopicRow, cmp, cursor, encodeCursor, html, invalid, language, limit, load, location, mapLimit, missing, numbers, paragraphs, sha, siteLink, teacherRank, verseKey, youtube } from './core';

export const naves = new Hono<App>();
async function topic(c: Ctx, slug: string) {
  if (!/^[a-z0-9-]{1,100}$/.test(slug)) return missing('NAVE_TOPIC_NOT_FOUND');
  const row = await load<Topic | null>(c, `/api/topics/${slug}.json`, true);
  if (!row) return missing('NAVE_TOPIC_NOT_FOUND');
  return row;
}
const summary = (row: TopicRow) => ({ normalizedName: row.slug, name: row.label, initial: row.label[0].toUpperCase() });
async function response(c: Ctx, row: Topic) {
  const description = [
    ...(row.thread ?? []).map(stop => `<h3>${siteLink(stop.url, stop.label)}</h3>${paragraphs(stop.text)}${[...stop.classes].sort((a, b) => teacherRank(a.teacher) - teacherRank(b.teacher)).map(n => `<p>${siteLink(n.url, n.title)} · ${html(n.date)} · ${html(n.teacher)} ${youtube(n.video, n.t, n.ts)}</p>`).join('')}${stop.precepts.map(p => `<p>${siteLink(p.url, p.label)}</p>${paragraphs(p.why ?? '')}`).join('')}`),
    ...row.items.map(n => `<p>${siteLink(n.url, n.title)}${n.date ? ` · ${html(n.date)}` : ''}${n.teacher ? ` · ${html(n.teacher)}` : ''}</p>`),
  ].join('');
  return c.json({ resource: { kind: 'nave', language: 'en', revision: `cj-topics-${await sha(row)}` }, topic: { ...summary(row), description } });
}
naves.get('/:language/topics', async c => {
  language(c, 'NAVE_UNSUPPORTED');
  const index = await load<TopicRow[]>(c, '/api/topics/index.json'), take = limit(c), after = cursor(c);
  if (after !== undefined && (!Array.isArray(after) || typeof after[0] !== 'string' || typeof after[1] !== 'string')) return invalid();
  const initial = (c.req.query('initial') ?? '').toLowerCase(), search = (c.req.query('search') ?? '').toLowerCase();
  const rows = index.filter(r => (!initial || r.label.toLowerCase().startsWith(initial)) && (!search || `${r.label} ${r.slug}`.toLowerCase().includes(search))).sort((a, b) => cmp(a.label, b.label) || cmp(a.slug, b.slug)).filter(r => !after || cmp(r.label, (after as string[])[0]) > 0 || r.label === (after as string[])[0] && cmp(r.slug, (after as string[])[1]) > 0);
  const page = rows.slice(0, take), last = page.at(-1);
  return c.json({ resource: { kind: 'nave', language: 'en', revision: `cj-topics-${await sha(index)}` }, topics: page.map(summary), limit: take, ...(rows.length > take && last ? { nextCursor: encodeCursor([last.label, last.slug]) } : {}) });
});
naves.get('/:language/topics/:normalizedName', async c => { language(c, 'NAVE_UNSUPPORTED'); return response(c, await topic(c, c.req.param('normalizedName'))); });
naves.get('/:language/random', async c => {
  language(c, 'NAVE_UNSUPPORTED');
  const index = await load<TopicRow[]>(c, '/api/topics/index.json');
  if (!index.length) return missing('NAVE_TOPIC_NOT_FOUND');
  return response(c, await topic(c, index[Math.floor(Math.random() * index.length)].slug));
});
naves.get('/:language/verses/:verseKey/topics', async c => {
  language(c, 'NAVE_UNSUPPORTED');
  const ref = verseKey(c.req.param('verseKey'));
  if (!ref.verse) return invalid('Nave verse keys require a positive verse number');
  const index = await load<TopicRow[]>(c, '/api/topics/index.json');
  // Topic threads are the authoritative verse associations (class topics alone are not).
  const matches = await mapLimit(index, async item => {
    const row = await topic(c, item.slug);
    const stops = (row.thread ?? []).filter(s => { const p = location(s.url); return p?.book === ref.book.id && p.chapter === ref.chapter; });
    return { normalizedName: row.slug, name: row.label, revision: await sha(row), verse: stops.some(s => numbers(s.verses).includes(ref.verse)), chapter: stops.some(s => !s.verses.trim()) };
  }, 3);
  const project = (row: typeof matches[number]) => ({ normalizedName: row.normalizedName, name: row.name });
  const verseTopics = matches.filter(r => r.verse).map(project), chapterTopics = matches.filter(r => r.chapter).map(project);
  return c.json({ resource: { kind: 'nave', language: 'en', revision: `cj-topics-${await sha(matches.map(r => r.revision))}` }, verseKey: c.req.param('verseKey'), verseTopics, chapterTopics });
});
