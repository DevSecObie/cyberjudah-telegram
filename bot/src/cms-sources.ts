import { z } from 'zod';
import type { Env } from './env';
import { FileSha, Reason, SourceList } from '../../shared/cms';
import { APP_REPO, SOURCES_FILE, CmsError, Github, createChange, type CmsActor } from './cms-github';
import { approvedSources, DEFAULT_SOURCES } from './source-policy';
const Config = z.strictObject({ revision: z.int().nonnegative(), hosts: SourceList });
async function source(env: Env) {
  const git = new Github(env, APP_REPO), main = await git.main(), file = await git.file(SOURCES_FILE, main.commit.sha);
  const config = Config.parse(JSON.parse(file.text));
  // Preserve any legacy KV customization on the first PR-backed save.
  return { main, file, config, hosts: config.revision ? config.hosts : await approvedSources(env) };
}
export async function readSources(env: Env) {
  const data = await source(env);
  return { hosts: data.hosts, defaults: DEFAULT_SOURCES, sha: data.file.sha };
}
export async function saveSources(env: Env, raw: unknown, by: CmsActor) {
  const input = z.strictObject({ sha: FileSha, hosts: SourceList, reason: Reason }).parse(raw), data = await source(env);
  if (data.file.sha !== input.sha) throw new CmsError('The outside-source list changed. Refresh it before saving.', 409);
  if ([...input.hosts].sort().join('\n') === [...data.hosts].sort().join('\n')) throw new CmsError('There is no change to save.');
  return createChange(env, { repo: APP_REPO, kind: 'sources', subject: 'outside-sources', title: 'Update outside sources', reason: input.reason, base: data.main.commit.sha, files: [{ ...data.file, text: JSON.stringify({ revision: data.config.revision + 1, hosts: [...input.hosts].sort() }, null, 2) + '\n' }] }, by);
}
