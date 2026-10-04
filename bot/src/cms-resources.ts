import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from './env';
import { Reason, type CmsChange } from '../../shared/cms';
import { CatalogSchema, MAX_CATALOG_BYTES, ResourceId, ReleaseId } from '../../shared/resources';
import { CmsError, recordChange } from './cms-github';
import { readCatalog, publishCatalog } from './resources';
export const cmsResources = new Hono<{ Bindings: Env; Variables: { tma: { user?: { id: number; first_name: string; username?: string } } } }>();
// Mounted behind the parent CMS admin gate. These changes explicitly apply without a PR.
cmsResources.get('/', async c => c.json(await readCatalog(c.env)));
cmsResources.get('/releases', async c => {
  const cursor = c.req.query('cursor');
  if (cursor && cursor.length > 2048) throw new CmsError('Invalid release page.');
  const list = await c.env.AUDIO.list({ prefix: 'resources/approved/', limit: 100, cursor });
  const releases = await Promise.all(list.objects.map(async o => {
    const match = /^resources\/approved\/([^/]+)\/([^/]+)\.json$/.exec(o.key);
    if (!match || !ResourceId.safeParse(match[1]).success || !ReleaseId.safeParse(match[2]).success) return null;
    const marker = await c.env.AUDIO.get(o.key);
    return marker ? { id: match[1], release: match[2], ...(await marker.json<{ manifestSha256: string }>()) } : null;
  }));
  return c.json({ releases: releases.filter(Boolean), cursor: list.truncated ? list.cursor : null });
});
cmsResources.post('/', async c => {
  const raw = await c.req.text(); if (raw.length > MAX_CATALOG_BYTES + 4000) throw new CmsError('Catalog is too large.');
  const input = z.strictObject({ catalog: CatalogSchema, etag: z.string().min(1).max(100), reason: Reason, confirm: z.literal('apply') }).parse(JSON.parse(raw));
  const user = c.get('tma').user!;
  const change: CmsChange = { id: crypto.randomUUID(), kind: 'resources', subject: `catalog-${input.catalog.revision}`, title: `Publish resource catalog revision ${input.catalog.revision}`, reason: input.reason, repo: '', branch: '', head: '', files: [], at: new Date().toISOString(), by: { id: user.id, name: user.username ? `@${user.username}` : user.first_name }, state: 'Checking', message: 'Validating resources before applying the catalog.' };
  await recordChange(c.env, change);
  let response: Response;
  try { response = await publishCatalog(c.env, input.catalog, input.etag); }
  catch { change.state = 'Failed'; change.message = 'The catalog could not be validated. Reload the catalog before retrying.'; await recordChange(c.env, change); throw new CmsError(change.message, 503); }
  if (!response.ok) {
    const result = await response.json<{ error: string }>(); change.state = 'Failed'; change.message = result.error;
    await recordChange(c.env, change); return c.json({ error: result.error }, response.status as 400 | 409 | 503);
  }
  change.state = 'Published'; change.message = 'The resource catalog is now live.';
  try { await recordChange(c.env, change); }
  catch { return c.json({ ...change, message: 'The resource catalog is live, but its final audit status could not be stored. Refresh the catalog before making another change.' }); }
  return c.json(change);
});
