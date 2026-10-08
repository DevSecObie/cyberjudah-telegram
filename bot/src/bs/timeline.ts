import { Hono } from 'hono';
import timeline from '../../../app/src/data/timeline.json';
import captivity from '../../../app/src/data/final-captivity.json';
import betweenTestaments from '../../../app/src/data/between-testaments.json';
import type { FcDetail } from '../../../shared/timeline-content';
import { photoManifest } from '../photos';
import { type App, type Ctx, invalid, limit, load, missing, sha } from './core';

type Event = {
  id: number; slug: string; title: string; start: number; end: number; row: number;
  type: string; approx?: boolean; isFixed?: boolean; portrait?: string; leader?: string;
  fc?: boolean; btt?: boolean; reign?: { kingdom: string; from: number; to: number; approx?: boolean };
  cases?: { slug: string; name: string; kind: string }[];
};
const sections = timeline.sections as (Omit<typeof timeline.sections[number], 'events'> & { events: Event[] })[];
const rows = sections.flatMap(section => section.events.map(event => ({ section, event })));
const details = { ...captivity, ...betweenTestaments } as unknown as Record<string, FcDetail>;
const approvedPictures = new Set(['1', '2', '4', '5', '6', '7', '8', '9', '10', '11', '12']);
const year = (n: number) => `${Math.abs(n)} ${n < 0 ? 'BC' : 'AD'}`;
const dates = (event: Event) => `${event.approx ? 'c. ' : ''}${year(event.start)}${event.end === event.start ? '' : `–${year(event.end)}`}`;
const resourceRevision = sha([timeline, captivity, betweenTestaments]);
const resource = async (language: string) => ({ kind: 'timeline', language, revision: `cj-timeline-${await resourceRevision}` });
const hasDetails = (event: Event) => !!(details[event.slug] || event.reign || event.cases?.length);
function language(c: Ctx) {
  const lang = c.req.param('language') ?? '';
  if (!['en', 'fr'].includes(lang)) return invalid();
  // The bilingual geometry contract is retained; CyberJudah's source text is English.
  return lang;
}
function portrait(event: Event, photos: Record<string, string>, origin: string) {
  const path = photos[`event:${event.slug}`] ?? (event.leader ? photos[`leader:${event.leader}`] : undefined)
    ?? (event.portrait ? `/api/img/people/${event.portrait}-256.webp` : event.leader ? `/api/img/timeline/leaders/${event.leader}-256.webp` : undefined);
  return path ? new URL(path, origin).href : undefined;
}
function summary(row: typeof rows[number], photos: Record<string, string>, origin: string) {
  const { section, event } = row, detail = details[event.slug];
  const image = portrait(event, photos, origin);
  return { id: String(event.id), slug: event.slug, title: event.title, description: detail?.summary ?? '', period: section.title,
    dates: detail?.date.text ?? dates(event), images: image ? [{ file: image, caption: event.title }] : [] };
}
const paragraphs = (heading: string, parts: (string | undefined)[]) => parts.filter(Boolean).length ? [heading, ...parts.filter(Boolean)].join('\n\n') : '';
/** Preserve the distinction between the historical account, attributed teaching and application. */
export function timelineArticle(detail: FcDetail) {
  return [
    [detail.group, detail.place, detail.region].filter(Boolean).join(' · '),
    paragraphs('Documented History — What Happened', [...(detail.tribes ?? []), ...(detail.people ?? []), ...(detail.account ?? [])]),
    paragraphs('Quotes and Sources — From the Classes', (detail.teaching ?? []).map(teaching => [
      teaching.quote ? `“${teaching.quote}”` : '',
      [teaching.source.title, teaching.teacher, teaching.source.date, teaching.source.ts ? `at ${teaching.source.ts}` : ''].filter(Boolean).join(' · '),
      teaching.source.url,
    ].filter(Boolean).join('\n'))),
    paragraphs('Scriptural Application — Scriptures', (detail.scriptures ?? []).map(ref => [ref.ref, ref.why].filter(Boolean).join(': '))),
    paragraphs('The answer — What the scriptures say', (detail.answer ?? []).map(ref => [ref.ref, ref.why].filter(Boolean).join(': '))),
    paragraphs('Where the sources differ', [...(detail.disagreements ?? []).map(item => [item.point, ...item.views].join('\n')), detail.uncertainty ? `Not settled: ${detail.uncertainty}` : undefined]),
    paragraphs('Sources', (detail.sources ?? []).map(source => [source.title, [source.author, source.publisher, source.year].filter(Boolean).join(', '), source.url, source.via ? `Archived copy: ${source.via}` : ''].filter(Boolean).join('\n'))),
  ].filter(Boolean).join('\n\n');
}

export const timelines = new Hono<App>();
timelines.get('/:language/sections', async c => {
  language(c);
  const photos = await photoManifest(c.env), origin = new URL(c.req.url).origin;
  return c.json(sections.map(section => {
    const image = photos[`period:${section.id}`] ?? (approvedPictures.has(section.id) ? `/api/img/timeline/periods/${section.id}.webp` : '');
    const description = section.events.filter(hasDetails).map(event => event.title).join('\n');
    return { ...section, titleEn: section.title, sectionTitleEn: section.sectionTitle, subTitleEn: section.subTitle,
      description, descriptionEn: description, image: image ? new URL(image, origin).href : '',
      events: section.events.map(event => ({ ...event, titleEn: event.title, image: portrait(event, photos, origin) })) };
  }));
});
timelines.get('/:language/events', async c => {
  const lang = language(c), take = limit(c, 100, 50), query = c.req.query('search')?.trim().toLocaleLowerCase();
  const photos = await photoManifest(c.env), origin = new URL(c.req.url).origin;
  const events = rows.filter(row => hasDetails(row.event)).map(row => summary(row, photos, origin));
  // A full index is used to enable events on the canvas. Only search is capped.
  return c.json({ resource: await resource(lang), events: query ? events.filter(event => `${event.title} ${event.description} ${event.dates}`.toLocaleLowerCase().includes(query)).slice(0, take) : events });
});
timelines.get('/:language/events/:slug', async c => {
  const lang = language(c), slug = c.req.param('slug'), row = rows.find(row => row.event.slug === slug);
  if (!row || !hasDetails(row.event)) return missing('TIMELINE_EVENT_NOT_FOUND');
  const photos = await photoManifest(c.env), origin = new URL(c.req.url).origin, detail = details[slug];
  const cases = await Promise.all((row.event.cases ?? []).map(item => load<{ title?: string; charge?: string; url?: string; refsResolved?: { label: string }[] } | null>(c, `/api/cases/${item.slug}.json`, true)));
  const article = detail ? timelineArticle(detail) : [
    row.event.reign ? `Reign — Who’s Who in the Bible\n\n${row.event.reign.approx ? 'c. ' : ''}${row.event.reign.from}–${row.event.reign.to} BC · ${row.event.reign.kingdom}` : '',
    paragraphs('Case studies', cases.map((item, index) => [row.event.cases![index].name, item?.charge, item?.url ? new URL(item.url, 'https://cyberjudah.io').href : ''].filter(Boolean).join('\n'))),
  ].filter(Boolean).join('\n\n');
  const scriptures = [...new Set([...(detail?.scriptures ?? []).map(ref => ref.ref), ...(detail?.answer ?? []).map(ref => ref.ref), ...cases.flatMap(item => (item?.refsResolved ?? []).map(ref => ref.label))])];
  const related = rows.filter(other => other.event.slug !== slug && hasDetails(other.event) && other.event.cases?.some(item => row.event.cases?.some(own => own.slug === item.slug))).map(other => ({ slug: other.event.slug, title: other.event.title }));
  const base = summary(row, photos, origin);
  const images = detail?.image ? [{ file: new URL(detail.image.src, origin).href, caption: [detail.image.kind === 'generated' ? 'Generated reconstruction' : 'Archival', detail.image.caption, detail.image.credit, detail.image.license].filter(Boolean).join(' · ') }] : base.images;
  return c.json({ resource: await resource(lang), event: { ...base, article, scriptures, related, images, videos: [] } });
});
