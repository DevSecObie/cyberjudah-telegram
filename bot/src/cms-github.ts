import { validSourceRevision } from './source-policy';
import type { Env } from './env';
import { decodeBase64, encodeBase64, NOTE_FILE } from './edit.mjs';
import type { CmsChange, CmsKind } from '../../shared/cms';

export const APP_REPO = 'DevSecObie/cyberjudah-telegram';
export const CONTENT_REPO = 'DevSecObie/cyberjudah';
export const TIMELINE_FILES = { events: 'app/scripts/final-captivity/events.json', drafts: 'app/scripts/final-captivity/drafts.json' };
export const SOURCES_FILE = 'bot/data/ask-sources.json';
export class CmsError extends Error { constructor(message: string, public status: 400 | 403 | 404 | 409 | 503 = 400) { super(message); } }
export function allowedFile(repo: string, kind: CmsChange['kind'], path: string): boolean {
  if (path.includes('..') || path.includes('\\') || path.startsWith('/')) return false;
  if (repo === APP_REPO) return kind === 'timeline' ? Object.values(TIMELINE_FILES).includes(path) : kind === 'sources' && path === SOURCES_FILE;
  return repo === CONTENT_REPO && kind === 'note' && NOTE_FILE.test(path);
}
const encoded = (path: string) => path.split('/').map(encodeURIComponent).join('/');
export class Github {
  constructor(private env: Env, public repo: string) {
    if (![APP_REPO, CONTENT_REPO].includes(repo)) throw new CmsError('This repository cannot be edited', 403);
  }
  private token() {
    const name = this.repo === APP_REPO ? 'APP_REPO_TOKEN' : 'CYBERJUDAH_TOKEN';
    const token = this.env[name];
    if (!token) throw new CmsError(`Editing is not configured: the Worker needs ${name}.`, 503);
    return token;
  }
  async request(path: string, init: RequestInit = {}) {
    let origin = 'https://api.github.com';
    // Only the existing local test mode can use the loopback GitHub stand-in.
    if (this.env.E2E_CLOCK === 'on' && this.env.CMS_GITHUB_API_ROOT) {
      const u = new URL(this.env.CMS_GITHUB_API_ROOT);
      if (u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname) && !u.username && !u.password) origin = u.href.replace(/\/$/, '');
    }
    const response = await fetch(`${origin}/repos/${this.repo}${path}`, { ...init, signal: AbortSignal.timeout(25_000), redirect: 'manual', headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${this.token()}`, 'user-agent': 'CyberJudah-CMS', 'x-github-api-version': '2022-11-28', 'content-type': 'application/json', ...init.headers } });
    if (!response.ok) {
      if ([409, 412, 422].includes(response.status)) throw new CmsError('GitHub could not apply this version. Refresh the change; another edit or repository rule may need attention.', 409);
      if ([401, 403].includes(response.status)) throw new CmsError('GitHub refused this operation. The repository token needs Contents and Pull requests read/write and Checks read.', 503);
      if (response.status === 404) throw new CmsError('The source file or change could not be found.', 404);
      throw new CmsError('GitHub is temporarily unavailable. Your edit has not been published.', 503);
    }
    return response;
  }
  async json<T>(path: string, init?: RequestInit): Promise<T> { return (await this.request(path, init)).json<T>(); }
  main() { return this.json<{ commit: { sha: string }; protected?: boolean; protection?: { required_status_checks?: { checks?: { context: string; app_id?: number }[]; contexts?: string[] } } }>('/branches/main'); }
  async file(path: string, ref: string) {
    const route = `/contents/${encoded(path)}?ref=${encodeURIComponent(ref)}`;
    const file = await this.json<{ sha: string; content: string; encoding: string; size: number; type: string }>(route);
    if (file.type !== 'file' || !/^[a-f0-9]{40}$/.test(file.sha) || file.size > 3_000_000) throw new CmsError('This source file is not supported by the editor.');
    const text = file.encoding === 'base64' ? decodeBase64(file.content) : await (await this.request(route, { headers: { accept: 'application/vnd.github.raw+json' } })).text();
    if (new TextEncoder().encode(text).length > 3_000_000) throw new CmsError('This source file is too large.');
    return { path, sha: file.sha, text };
  }
  async put(path: string, text: string, sha: string, branch: string, kind: CmsKind, title: string) {
    if (!allowedFile(this.repo, kind, path) || !/^cms\/[a-z0-9-]+$/.test(branch)) throw new CmsError('This file or branch cannot be changed.', 403);
    return this.json<{ commit: { sha: string } }>(`/contents/${encoded(path)}`, { method: 'PUT', body: JSON.stringify({ message: `CMS: ${title}`, content: encodeBase64(text), sha, branch }) });
  }
}
export type FileEdit = { path: string; sha: string; text: string };
export type CmsActor = { id: number; name: string };
const setup = async (env: Env) => { await env.DB.prepare('CREATE TABLE IF NOT EXISTS cms_changes (id TEXT PRIMARY KEY, at TEXT NOT NULL, data TEXT NOT NULL)').run(); };
export async function recordChange(env: Env, change: CmsChange) {
  await setup(env);
  await env.DB.prepare('INSERT INTO cms_changes (id, at, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data').bind(change.id, change.at, JSON.stringify(change)).run();
}
export async function getChange(env: Env, id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new CmsError('Change not found.', 404);
  await setup(env);
  const row = await env.DB.prepare('SELECT data FROM cms_changes WHERE id = ?').bind(id).first<{ data: string }>();
  if (!row) throw new CmsError('Change not found.', 404);
  return JSON.parse(row.data) as CmsChange;
}
export async function recentChanges(env: Env, cursor?: string) {
  await setup(env);
  let before: { at: string; id: string } | undefined;
  if (cursor) {
    if (cursor.length > 200) throw new CmsError('Invalid change history page.');
    try { before = JSON.parse(cursor); } catch { throw new CmsError('Invalid change history page.'); }
    if (!before || !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(before.at) || !/^[a-f0-9-]{36}$/.test(before.id)) throw new CmsError('Invalid change history page.');
  }
  const statement = before
    ? env.DB.prepare('SELECT data FROM cms_changes WHERE at < ? OR (at = ? AND id < ?) ORDER BY at DESC, id DESC LIMIT 51').bind(before.at, before.at, before.id)
    : env.DB.prepare('SELECT data FROM cms_changes ORDER BY at DESC, id DESC LIMIT 51');
  const rows = await statement.all<{ data: string }>();
  const changes = rows.results.slice(0, 50).map(r => JSON.parse(r.data) as CmsChange), last = changes.at(-1);
  return { changes, cursor: rows.results.length > 50 && last ? JSON.stringify({ at: last.at, id: last.id }) : null };
}
export async function createChange(env: Env, plan: { repo: string; kind: CmsKind; subject: string; title: string; reason: string; base: string; files: FileEdit[] }, by: CmsActor) {
  if (!plan.files.length || plan.files.some(f => !allowedFile(plan.repo, plan.kind, f.path))) throw new CmsError('This edit is outside the allowed content paths.', 403);
  const git = new Github(env, plan.repo);
  // Check the file versions on main immediately before creating a review branch.
  const current = await git.main();
  for (const file of plan.files) if ((await git.file(file.path, current.commit.sha)).sha !== file.sha) throw new CmsError('This content changed since you opened it. Reload it and apply your correction to the new version.', 409);
  const id = crypto.randomUUID(), at = new Date().toISOString();
  const branch = `cms/${plan.kind}-${plan.subject.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 45)}-${Date.now().toString(36)}-${id.slice(0, 6)}`;
  const change: CmsChange = { id, at, by, repo: plan.repo, kind: plan.kind, subject: plan.subject, title: plan.title, reason: plan.reason, branch, head: current.commit.sha, files: plan.files.map(({ path, sha }) => ({ path, sha })), state: 'Checking', message: 'Creating the review branch.' };
  await recordChange(env, change);
  let attemptedBranch = false;
  try {
    attemptedBranch = true;
    await git.json('/git/refs', { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: current.commit.sha }) });
    for (const file of plan.files) change.head = (await git.put(file.path, file.text, file.sha, branch, plan.kind, plan.title)).commit.sha;
    const body = `Edited by ${by.name} (Telegram user ${by.id}) in CyberJudah.\n\nReason: ${plan.reason}\n\nContent: ${plan.kind} / ${plan.subject}\n\nFiles:\n${plan.files.map(f => `- ${f.path}`).join('\n')}\n\nChangelog: not applicable — an admin content correction recorded in the CMS audit trail.\n\nPublication requires the admin's Publish action after checks pass. Production deployment approval remains separate.\n\nCMS change: ${id}`;
    const pull = await git.json<{ number: number; html_url: string }>('/pulls', { method: 'POST', body: JSON.stringify({ title: `CMS: ${plan.title}`.slice(0, 240), body, head: branch, base: 'main', draft: false }) });
    change.pr = pull.number; change.url = pull.html_url; change.message = 'Waiting for repository checks.';
    await recordChange(env, change); return change;
  } catch (e) {
    // A lost POST response may still have opened the PR. Confirm absence before
    // deleting our branch; preserve it when GitHub cannot answer safely.
    if (attemptedBranch && !change.pr) {
      try {
        const pulls = await git.json<{ number: number; html_url: string }[]>(`/pulls?state=all&head=${encodeURIComponent(plan.repo.split('/')[0] + ':' + branch)}&per_page=1`);
        if (pulls.length) { change.pr = pulls[0].number; change.url = pulls[0].html_url; }
        else await git.request(`/git/refs/heads/${encoded(branch)}`, { method: 'DELETE' });
      } catch { /* Preserve the branch if its review status is uncertain. */ }
    }
    change.state = 'Failed'; change.message = e instanceof CmsError ? e.message : 'The save could not finish. Check Recent changes before retrying.';
    await recordChange(env, change); throw e;
  }
}
type Pull = { state: string; merged: boolean; merge_commit_sha?: string; mergeable: boolean | null; mergeable_state: string; draft: boolean; head: { sha: string; ref: string; repo: { full_name: string } }; base: { ref: string } };
type Check = { id: number; name: string; status: string; conclusion: string | null; app: { id: number }; output?: { title?: string; summary?: string } };
const plain = (v: string) => v.replaceAll('<', '‹').replaceAll('>', '›').replace(/\s+/g, ' ').slice(0, 600);
async function published(env: Env, git: Github, change: CmsChange, mergeSha?: string) {
  change.state = 'Published'; change.canPublish = false;
  change.message = change.repo === CONTENT_REPO
    ? 'Published. Readers will see it after the data set rebuilds (a few minutes).'
    : 'Published. Readers will see it after the next update is approved.';
  if (change.kind === 'sources') {
    try {
      if (!mergeSha || !/^[a-f0-9]{40}$/.test(mergeSha)) throw new Error('Missing merge revision');
      const config: unknown = JSON.parse((await git.file(SOURCES_FILE, mergeSha)).text);
      if (!validSourceRevision(config)) throw new Error('Invalid source revision');
      const current = await env.SUBS.get('ask:sources', 'json');
      if (!validSourceRevision(current) || current.revision < config.revision) await env.SUBS.put('ask:sources', JSON.stringify(config));
      change.state = 'Live'; change.message = 'Live. The published outside-source policy is active; KV propagation can take up to a minute.';
    } catch {
      change.message = 'Published. The outside-source policy could not be activated yet. Refresh status to retry; no deployment is needed.';
    }
  }
}
export async function refreshChange(env: Env, id: string) {
  const change = await getChange(env, id); change.canPublish = false;
  if (!change.pr) return change;
  const git = new Github(env, change.repo), pull = await git.json<Pull>(`/pulls/${change.pr}`);
  if (pull.merged) { await published(env, git, change, pull.merge_commit_sha); }
  else if (pull.state === 'closed') { change.state = 'Closed'; change.message = 'This change was closed without publishing.'; }
  else if (pull.head.sha !== change.head || pull.head.ref !== change.branch || pull.head.repo.full_name !== change.repo || pull.base.ref !== 'main') { change.state = 'Failed'; change.message = 'The review branch changed outside this editor. Review it in GitHub; this version cannot be published from the app.'; }
  else {
    const branch = await git.main();
    // Active rulesets supplement classic branch protection. This read endpoint needs
    // repository metadata only; no token gets Administration or workflow permissions.
    const rules = await git.json<{ type: string; parameters?: { required_status_checks?: { context: string; integration_id?: number }[] } }[]>('/rules/branches/main');
    const protectedChecks = branch.protection?.required_status_checks;
    const required = { contexts: protectedChecks?.contexts ?? [], checks: [...(protectedChecks?.checks ?? []), ...rules.filter(r => r.type === 'required_status_checks').flatMap(r => (r.parameters?.required_status_checks ?? []).map(s => ({ context: s.context, app_id: s.integration_id })))] };
    const names = new Set([...(required?.contexts ?? []), ...(required?.checks ?? []).map(c => c.context), ...(change.repo === APP_REPO ? ['check', 'CodeQL', 'codeql', 'dependency-review', 'playwright', 'cms-content'] : ['validate'])]);
    const runs: Check[] = [];
    for (let page = 1; page <= 10; page++) {
      const result = await git.json<{ check_runs: Check[] }>(`/commits/${change.head}/check-runs?filter=latest&per_page=100&page=${page}`);
      runs.push(...result.check_runs); if (result.check_runs.length < 100) break;
      if (page === 10) throw new CmsError('There are too many check results to verify safely.', 503);
    }
    // GitHub's filter=latest applies within suites; a restarted workflow can
    // leave older cancelled/failed runs in another suite for this same commit.
    // Names are status contexts. Keep the newest result per issuing GitHub App
    // so a different integration cannot replace a required app's result.
    const latest = new Map<string, Check>();
    for (const run of runs) {
      const key = `${run.app.id}:${run.name}`, prior = latest.get(key);
      if (!prior || run.id > prior.id) latest.set(key, run);
    }
    const checks = [...latest.values()];
    const failed = checks.find(c => c.status === 'completed' && !['success', 'skipped', 'neutral'].includes(c.conclusion ?? ''));
    const missing = [...names].filter(name => !checks.some(c => c.name === name && c.status === 'completed' && c.conclusion === 'success' && !(required?.checks ?? []).some(r => r.context === name && r.app_id != null && r.app_id !== c.app.id)));
    if (failed) {
      let detail = failed.output?.summary || failed.output?.title;
      // GitHub Actions often leaves summary/title empty and reports the error only
      // in annotations. Read the fixed API path, never an output-supplied URL.
      if (!detail && Number.isSafeInteger(failed.id) && failed.id > 0) {
        try {
          const annotations = await git.json<{ annotation_level: string; message: string }[]>(`/check-runs/${failed.id}/annotations?per_page=100`);
          const failures = annotations.filter(a => a.annotation_level === 'failure' && a.message);
          detail = failures.find(a => !/^Process completed with exit code/.test(a.message))?.message || failures[0]?.message;
        } catch { /* Keep the failure visible even when diagnostics are unavailable. */ }
      }
      change.state = 'Failed'; change.message = `${failed.name} failed. ${plain(detail || 'Open the review for the failing check and correct the content.')}`;
    }
    else if (missing.length || checks.some(c => c.status !== 'completed')) { change.state = 'Checking'; change.message = `Waiting for ${missing.length ? missing.join(', ') : 'the remaining checks'}.`; }
    else { change.state = 'Passed'; change.canPublish = pull.mergeable === true && !pull.draft && ['clean', 'unstable', 'has_hooks'].includes(pull.mergeable_state); change.message = change.canPublish ? 'Checks passed. Publish merges this reviewed version.' : 'Checks passed. GitHub still requires a branch update, review or conflict resolution before publishing.'; }
  }
  await recordChange(env, change); return change;
}
export async function publishChange(env: Env, id: string, expectedHead: string, by: CmsActor) {
  const change = await refreshChange(env, id);
  if (change.head !== expectedHead) throw new CmsError('This review changed. Refresh before publishing.', 409);
  if (change.state !== 'Passed' || !change.canPublish || !change.pr) throw new CmsError(change.message, 409);
  const git = new Github(env, change.repo);
  const files = await git.json<{ filename: string; status: string }[]>(`/pulls/${change.pr}/files?per_page=100`);
  if (files.length !== change.files.length || files.some(f => f.status !== 'modified' || !change.files.some(known => known.path === f.filename) || !allowedFile(change.repo, change.kind, f.filename))) throw new CmsError('The review contains files outside this edit. Publish was refused.', 409);
  const result = await git.json<{ merged: boolean; sha?: string }>(`/pulls/${change.pr}/merge`, { method: 'PUT', body: JSON.stringify({ sha: expectedHead, merge_method: 'squash', commit_title: `CMS: ${change.title}`.slice(0, 240), commit_message: `Edited by ${change.by.name} (Telegram ${change.by.id}). Published by ${by.name} (Telegram ${by.id}).\n\n${change.reason}` }) });
  if (!result.merged) throw new CmsError('GitHub did not merge this change. Refresh to see which requirement remains.', 409);
  await published(env, git, change, result.sha);
  await recordChange(env, change); return change;
}
