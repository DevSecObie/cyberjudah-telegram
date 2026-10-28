import { Hono } from 'hono';
import publication from '../../data/bs-timeline.json';
import { type App, invalid, limit, missing } from './core';

export const timelines = new Hono<App>();
const resource = (language: string) => {
  if (!['en', 'fr'].includes(language)) return invalid();
  return { kind: 'timeline', language, revision: publication.revision };
};
const summary = ({ id, slug, title, description, period, dates, images }: typeof publication.events[number]) => ({ id, slug, title, description, period, dates, images });
timelines.use('*', async (c, next) => {
  // The published CyberJudah timeline is English. A French UI retains the original text.
  c.header('content-language', publication.source.language);
  await next();
});
timelines.get('/:language/events', c => {
  const revision = resource(c.req.param('language'));
  const query = c.req.query('search');
  if (query && query.length > 200) return invalid();
  const count = limit(c, 100, 50);
  const words = query?.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean) ?? [];
  const events = words.length ? publication.events.filter(e => {
    const haystack = `${e.title} ${e.description} ${e.article}`.toLocaleLowerCase();
    return words.every(word => haystack.includes(word));
  }) : publication.events;
  // The unfiltered index determines which bars open. Never truncate it to a search page.
  const page = query !== undefined || c.req.query('limit') !== undefined ? events.slice(0, count) : events;
  return c.json({ resource: revision, events: page.map(summary) });
});
timelines.get('/:language/events/:slug', c => {
  const revision = resource(c.req.param('language'));
  const event = publication.events.find(e => e.slug === c.req.param('slug'));
  if (!event) return missing('TIMELINE_EVENT_NOT_FOUND');
  return c.json({ resource: revision, event });
});
