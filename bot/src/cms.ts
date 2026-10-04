import { cmsResources } from "./cms-resources";
import { readSources, saveSources } from "./cms-sources";
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { isAdminId } from './edit.mjs';
import type { Env } from './env';
import { TimelineSave, FileSha, timelineSchema, GROUPS, PEOPLES, TRIBES, type TimelineEntry, type CmsPeriod } from '../../shared/cms';
import { APP_REPO, CmsError, Github, TIMELINE_FILES, createChange, recentChanges, refreshChange, publishChange } from './cms-github';

type App = { Bindings: Env; Variables: { tma: { user?: { id: number; first_name: string; username?: string } } } };
export const cms = new Hono<App>();
cms.use('*', async (c, next) => {
  if (!isAdminId(c.env.ADMIN_IDS, c.get('tma')?.user?.id ?? 0)) return c.json({ error: 'Only an admin can edit app content.' }, 403);
  c.header('cache-control', 'no-store');
  await next();
});
cms.use('*', bodyLimit({ maxSize: 1_000_000, onError: c => c.json({ error: 'This edit is too large.' }, 413) }));
cms.onError((error, c) => {
  if (error instanceof SyntaxError) return c.json({ error: 'The edit is not valid JSON.' }, 400);
  if (error instanceof z.ZodError) return c.json({ error: error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('\n').slice(0, 3000) }, 400);
  if (error instanceof CmsError) return c.json({ error: error.message }, error.status);
  return c.json({ error: 'The editor could not finish this request. Check Recent changes before saving again.' }, 503);
});
const actor = (user: { id: number; first_name: string; username?: string }) => ({ id: user.id, name: user.username ? `@${user.username}` : user.first_name });
async function timeline(env: Env) {
  const git = new Github(env, APP_REPO), branch = await git.main();
  const [events, drafts, periods, leaders] = await Promise.all([TIMELINE_FILES.events, TIMELINE_FILES.drafts, 'app/scripts/final-captivity/periods.json', 'app/scripts/final-captivity/leaders.json'].map(p => git.file(p, branch.commit.sha)));
  return { base: branch.commit.sha, events, drafts, lists: { events: JSON.parse(events.text) as TimelineEntry[], drafts: JSON.parse(drafts.text) as TimelineEntry[] }, periods: JSON.parse(periods.text).periods as CmsPeriod[], leaders: JSON.parse(leaders.text).leaders as { id: string; name: string }[] };
}
cms.get('/timeline', async c => {
  const data = await timeline(c.env);
  return c.json({ entries: [...data.lists.events.map(e => ({ id: e.slug, title: e.title, draft: false })), ...data.lists.drafts.map(e => ({ id: e.slug, title: e.title, draft: true }))] });
});
cms.get('/timeline/:id', async c => {
  const data = await timeline(c.env), id = c.req.param('id');
  const entry = [...data.lists.events, ...data.lists.drafts].find(e => e.slug === id);
  if (!entry && id !== 'new') throw new CmsError('Timeline event not found.', 404);
  return c.json({ event: entry ?? null, draft: entry ? data.lists.drafts.some(e => e.slug === id) : true, shas: { events: data.events.sha, drafts: data.drafts.sha }, periods: data.periods, leaders: data.leaders, groups: GROUPS, peoples: PEOPLES, tribes: Object.keys(TRIBES) });
});
cms.post('/timeline', async c => {
  const raw = await c.req.text(); if (raw.length > 1_000_000) throw new CmsError('This edit is too large.');
  const input = TimelineSave.parse(JSON.parse(raw)), data = await timeline(c.env);
  if (input.shas.events !== data.events.sha || input.shas.drafts !== data.drafts.sha) throw new CmsError('The Timeline changed since you opened it. Reload it and apply your correction to the new version.', 409);
  if (input.event.slug !== input.id) throw new CmsError('An existing event id cannot be renamed.');
  const existing = [...data.lists.events, ...data.lists.drafts].find(e => e.slug === input.id), wasDraft = data.lists.drafts.some(e => e.slug === input.id);
  if (input.action === 'add' ? !!existing : !existing) throw new CmsError(input.action === 'add' ? 'That event id already exists.' : 'The event no longer exists.', 409);
  if (input.action === 'publish' && !wasDraft || input.action === 'unpublish' && (!existing || wasDraft)) throw new CmsError('This event has already moved. Refresh before editing.', 409);
  const draft = input.action === 'publish' ? false : input.action === 'unpublish' ? true : input.action === 'add' ? input.draft : wasDraft;
  const event = timelineSchema(data.periods, data.leaders, draft).parse({ ...input.event, status: draft ? 'draft' : 'published' });
  const events = data.lists.events.filter(e => e.slug !== input.id), drafts = data.lists.drafts.filter(e => e.slug !== input.id);
  (draft ? drafts : events).push(event);
  const order = new Map(data.periods.map((p, i) => [p.id, i]));
  events.sort((a, b) => order.get(a.period)! - order.get(b.period)! || a.start! - b.start! || a.end! - b.end! || data.lists.events.findIndex(e => e.slug === a.slug) - data.lists.events.findIndex(e => e.slug === b.slug));
  // Keep draft order stable when editing an existing draft.
  if (draft && wasDraft) drafts.sort((a, b) => data.lists.drafts.findIndex(e => e.slug === a.slug) - data.lists.drafts.findIndex(e => e.slug === b.slug));
  const files = [{ ...data.events, text: JSON.stringify(events, null, 1) + '\n' }, { ...data.drafts, text: JSON.stringify(drafts, null, 1) + '\n' }].filter(f => f.text !== (f.path === data.events.path ? data.events.text : data.drafts.text));
  if (!files.length) throw new CmsError('There is no content change to save.');
  return c.json(await createChange(c.env, { repo: APP_REPO, kind: 'timeline', subject: input.id, title: `${input.action === 'publish' ? 'Publish' : input.action === 'unpublish' ? 'Unpublish' : input.action === 'add' ? 'Add' : 'Edit'} Timeline event: ${event.title}`, reason: input.reason, base: data.base, files }, actor(c.get('tma').user!)), 201);
});
cms.get('/sources', async c => c.json(await readSources(c.env)));
cms.post('/sources', async c => c.json(await saveSources(c.env, await c.req.json(), actor(c.get('tma').user!)), 201));
cms.get('/changes', async c => c.json({ changes: await recentChanges(c.env) }));
cms.get('/changes/:id', async c => c.json(await refreshChange(c.env, c.req.param('id'))));
cms.post('/changes/:id/publish', async c => {
  const input = z.strictObject({ head: FileSha, confirm: z.literal('publish') }).parse(await c.req.json());
  return c.json(await publishChange(c.env, c.req.param('id'), input.head, actor(c.get('tma').user!)));
});

cms.route('/resources', cmsResources);
