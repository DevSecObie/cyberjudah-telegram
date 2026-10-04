import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../../src/index.ts';
import { signInitData } from '../../src/initdata.mjs';
import type { Env } from '../../src/env.ts';
import { FakeGithub } from '../fixtures/cms-github.mjs';
import { allowedFile, APP_REPO, CONTENT_REPO, TIMELINE_FILES, createChange, Github } from '../../src/cms-github.ts';
import { CalendarDate, NoteSave, SourceList, resolveScripture, timelineSchema } from '../../../shared/cms.ts';
let fake: FakeGithub, env: Env, db: DatabaseSync;
const originalFetch = globalThis.fetch;
beforeEach(() => {
  fake = new FakeGithub(); globalThis.fetch = fake.fetch as typeof fetch; db = new DatabaseSync(':memory:');
  const d1 = { prepare(sql: string) { const statement = db.prepare(sql); let args: (string | number)[] = []; return { bind(...a: (string | number)[]) { args = a; return this; }, async run() { return statement.run(...args); }, async first() { return statement.get(...args) ?? null; }, async all() { return { results: statement.all(...args) }; } }; } };
  env = { DB: d1, BOT_TOKEN: 'cms-tests', ADMIN_IDS: '42', APP_REPO_TOKEN: 'app-token-stays-here', CYBERJUDAH_TOKEN: 'content-token-stays-here', SUBS: { get: async () => ['legacy.example.org'] } } as unknown as Env;
});
afterEach(() => { globalThis.fetch = originalFetch; db.close(); });
async function request(path: string, method = 'GET', body?: unknown, user = 42) {
  const headers: Record<string,string> = { 'content-type': 'application/json' };
  if (user) headers.authorization = `tma ${await signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: { id: user, first_name: 'Test admin' } }, env.BOT_TOKEN)}`;
  return worker.fetch(new Request(`https://worker.invalid/api/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
}
async function loaded() {
  const list = await (await request('admin/cms/timeline')).json() as any;
  return (await (await request(`admin/cms/timeline/${list.entries[0].id}`)).json()) as any;
}
async function save() { const data = await loaded(); const response = await request('admin/cms/timeline', 'POST', { ...pick(data), event: { ...data.event, title: data.event.title + ' correction' } }); assert.equal(response.status, 201, await response.clone().text()); return await response.json() as any; }
const pick = (data: any) => ({ id: data.event.slug, action: 'edit', draft: data.draft, shas: data.shas, event: data.event, reason: 'Correct source wording' });

test('every CMS route refuses unsigned and non-admin readers before touching GitHub', async () => {
  for (const [path, method] of [['timeline','GET'],['timeline/new','GET'],['timeline','POST'],['sources','GET'],['sources','POST'],['changes','GET'],['changes/00000000-0000-0000-0000-000000000000','GET'],['changes/00000000-0000-0000-0000-000000000000/publish','POST'],['resources','GET'],['resources','POST'],['resources/releases','GET']]) {
    assert.equal((await request(`admin/cms/${path}`, method, method === 'POST' ? {} : undefined, 7)).status, 403);
    assert.equal((await request(`admin/cms/${path}`, method, method === 'POST' ? {} : undefined, 0)).status, 401);
  }
  for (const [path, method] of [['admin/ask-sources','PUT'],['admin/ask-sources','GET'],['notes/source?file=blog/2026/test.md','GET'],['notes/edit','POST']]) assert.equal((await request(path, method, method === 'GET' ? undefined : {}, 7)).status, 403);
  assert.equal(fake.calls.length, 0);
});
test('path allowlist distinguishes repositories and refuses traversal, scripts and generated files', async () => {
  assert.ok(allowedFile(APP_REPO, 'timeline', TIMELINE_FILES.events)); assert.ok(allowedFile(CONTENT_REPO, 'note', 'blog/2026/test.md'));
  for (const path of ['../events.json', 'app/src/data/final-captivity.json', '.github/workflows/deploy.yml', 'bot/src/index.ts', 'app/scripts/final-captivity/build.mjs']) {
    assert.equal(allowedFile(APP_REPO, 'timeline', path), false);
    await assert.rejects(createChange(env, { repo: APP_REPO, kind: 'timeline', subject: 'x', title: 'x', reason: 'x', base: '', files: [{ path, sha: 'a'.repeat(40), text: '' }] }, { id: 42, name: 'Test' }), /allowed content/);
  }
  assert.equal(allowedFile(APP_REPO, 'note', 'blog/2026/test.md'), false);
  await assert.rejects(new Github(env, APP_REPO).put(TIMELINE_FILES.events, '[]', 'a'.repeat(40), 'main', 'timeline', 'test'), /cannot be changed/);
  assert.equal(fake.calls.length, 0);
});
test('Timeline save branches, opens a PR, records identity and goes Checking → Passed → explicit squash Publish', async () => {
  const change = await save(); assert.equal(change.state, 'Checking'); assert.match(change.branch, /^cms\/timeline-/);
  const writes = fake.calls.filter(c => c.method === 'PUT'); assert.ok(writes.length); assert.ok(writes.every(c => c.body.branch.startsWith('cms/')));
  assert.ok(writes.every(c => c.headers.authorization === 'Bearer app-token-stays-here'));
  const pr = fake.calls.find(c => c.route.endsWith('/pulls') && c.method === 'POST')!;
  assert.match(pr.body.title, /^CMS: /); assert.match(pr.body.body, /Test admin.*42/); assert.match(pr.body.body, /Correct source wording/);
  const route = `admin/cms/changes/${change.id}`;
  assert.equal((await (await request(route)).json() as any).state, 'Checking');
  assert.equal((await request(route + '/publish', 'POST', { head: change.head, confirm: 'publish' })).status, 409);
  fake.checks = 'success';
  const passed = await (await request(route)).json() as any; assert.equal(passed.state, 'Passed'); assert.equal(passed.canPublish, true);
  assert.equal(fake.calls.filter(c => c.route.endsWith('/merge')).length, 0);
  assert.equal((await request(route + '/publish', 'POST', { head: change.head })).status, 400);
  assert.equal((await request(route + '/publish', 'POST', { head: 'f'.repeat(40), confirm: 'publish' })).status, 409);
  const result = await request(route + '/publish', 'POST', { head: change.head, confirm: 'publish' }); assert.equal(result.status, 200);
  assert.equal((await result.json() as any).state, 'Published');
  assert.deepEqual(fake.calls.find(c => c.route.endsWith('/merge'))?.body.sha, change.head);
  assert.equal(fake.calls.find(c => c.route.endsWith('/merge'))?.body.merge_method, 'squash');
  const audit = await (await request('admin/cms/changes')).json() as any; assert.equal(audit.changes[0].by.id, 42); assert.equal(audit.changes[0].url, change.url); assert.equal(audit.changes[0].state, 'Published');
  assert.ok(!JSON.stringify(audit).includes('token-stays-here'));
});
test('bad Timeline data and stale SHAs are refused without creating a branch', async () => {
  const data = await loaded();
  for (const edit of [{ ...pick(data), shas: { ...data.shas, drafts: '0'.repeat(40) } }, { ...pick(data), event: { ...data.event, tribes: ['Not a tribe'] } }, { ...pick(data), event: { ...data.event, scriptures: [{ ref: 'Genesis 999:1' }] } }, { ...pick(data), path: 'bot/src/index.ts' }]) {
    const response = await request('admin/cms/timeline', 'POST', edit); assert.ok([400,409].includes(response.status));
  }
  assert.equal(fake.calls.filter(c => c.method === 'POST').length, 0);
});
test('failed checks, check app impersonation, changed heads and unexpected files block publication', async () => {
  const c = await save(), route = `admin/cms/changes/${c.id}`;
  fake.checks = 'failure'; const failed = await (await request(route)).json() as any; assert.equal(failed.state, 'Failed'); assert.match(failed.message, /quoted passage/);
  fake.checks = 'success'; fake.wrongApp = true; assert.equal((await (await request(route)).json() as any).state, 'Checking');
  fake.wrongApp = false; fake.rules = [{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'owner-added-check', integration_id: 15368 }] } }];
  assert.equal((await (await request(route)).json() as any).state, 'Checking');
  fake.rules = []; fake.extraFiles = [{ filename: 'bot/src/index.ts', status: 'modified' }];
  assert.equal((await request(route + '/publish', 'POST', { head: c.head, confirm: 'publish' })).status, 409);
  fake.extraFiles = []; fake.pulls.get(c.pr).head.sha = 'b'.repeat(40);
  assert.equal((await (await request(route)).json() as any).state, 'Failed');
  assert.equal((await request(route + '/publish', 'POST', { head: c.head, confirm: 'publish' })).status, 409);
  assert.ok(!fake.calls.some(c => c.route.endsWith('/merge')));
});
test('draft creation, publication and unpublication modify only the two Timeline source files', async () => {
  const data = await loaded(), input = { ...pick(data), action: 'add', id: 'test-draft', draft: true, event: { slug: 'test-draft', title: 'Unverified draft', period: data.event.period } };
  assert.equal((await request('admin/cms/timeline', 'POST', input)).status, 201);
  assert.equal((await request('admin/cms/timeline', 'POST', { ...pick(data), action: 'unpublish' })).status, 201);
  const writes = fake.calls.filter(c => c.method === 'PUT'); assert.ok(writes.every(c => Object.values(TIMELINE_FILES).some(path => c.route.endsWith(path))));
  const drafts = JSON.parse(fake.files.get(TIMELINE_FILES.drafts)!); const draft = drafts[0];
  assert.equal((await request('admin/cms/timeline','POST', { ...pick(data), id: draft.slug, event: draft, draft: true, action: 'publish' })).status, 400, 'Incomplete draft cannot be published');
});
test('note quick fixes require a source SHA and reason and use only the content repository token', async () => {
  const file = 'blog/2026/test.md'; const source = await (await request(`notes/source?file=${file}`)).json() as any;
  assert.equal((await request('notes/edit','POST',{ file, teacher:'Correct teacher' })).status,400);
  assert.equal((await request('notes/edit','POST',{ file, sha:'a'.repeat(40), teacher:'Correct teacher', reason:'Source correction' })).status,409);
  const response = await request('notes/edit','POST',{ file, sha:source.sha, teacher:'Correct teacher', reason:'Source correction' }); assert.equal(response.status,200,await response.clone().text());
  const result = await response.json() as any; assert.ok(result.change.pr); assert.match(result.commit,/\/pull\//);
  assert.ok(fake.calls.filter(c => c.method === 'PUT').every(c => c.headers.authorization === 'Bearer content-token-stays-here' && c.body.branch.startsWith('cms/')));
});
test('outside-source migration preserves legacy sites, labels defaults and saves to a PR with CAS', async () => {
  const initial = await (await request('admin/ask-sources')).json() as any;
  assert.deepEqual(initial.hosts,['legacy.example.org']); assert.ok(new Set(initial.defaults).has('archive.org'));
  assert.equal((await request('admin/ask-sources','PUT',{sha:initial.sha,hosts:['https://bad.invalid/path'],reason:'Source correction'})).status,400);
  assert.equal((await request('admin/ask-sources','PUT',{sha:'a'.repeat(40),hosts:['archive.org'],reason:'Source correction'})).status,409);
  const response = await request('admin/ask-sources','PUT',{sha:initial.sha,hosts:[...initial.hosts,'archive.org'],reason:'Add archive evidence'}); assert.equal(response.status,201,await response.clone().text());
  const write = fake.calls.find(c => c.method === 'PUT')!; const body = JSON.parse(Buffer.from(write.body.content,'base64').toString()); assert.deepEqual(body,{revision:1,hosts:['archive.org','legacy.example.org']});
});
test('validators preserve existing events but reject invalid dates, groups, image credits and real verse bounds', () => {
  const read = (f: string) => JSON.parse(readFileSync(new URL(`../../../app/scripts/final-captivity/${f}.json`,import.meta.url),'utf8'));
  const periods = read('periods').periods, leaders = read('leaders').leaders, events = read('events'), drafts = read('drafts');
  for (const event of events) assert.ok(timelineSchema(periods,leaders,false).safeParse(event).success,event.slug);
  for (const event of drafts) assert.ok(timelineSchema(periods,leaders,true).safeParse(event).success,event.slug);
  for (const fields of [{ period:'missing' },{ group:'missing' },{ end:0 },{ date:{text:'unknown',precision:'guess'} },{ image:{kind:'archival',src:'https://example.org/a.jpg',caption:'Example'} }]) assert.equal(timelineSchema(periods,leaders,false).safeParse({...events[0],...fields}).success,false);
  assert.ok(CalendarDate.safeParse('2024-02-29').success); assert.equal(CalendarDate.safeParse('2025-02-29').success,false);
  assert.ok(resolveScripture('Genesis 1:1-3')); assert.ok(resolveScripture('Ecclesiasticus 1:1')); assert.equal(resolveScripture('Genesis 1:32'),null); assert.equal(resolveScripture('Jude 2:1'),null);
  assert.equal(SourceList.safeParse(['archive.org','archive.org']).success,false);
  assert.equal(NoteSave.safeParse({file:'blog/2026/test.md',body:'changed'}).success,false);
});

test('resource changes require explicit confirmation, preserve CAS and record outcomes without a PR', async () => {
  const files = new Map<string,string>(); let version = 0;
  const object = (key: string) => files.has(key) ? { size: files.get(key)!.length, httpEtag: `"${version}"`, json: async()=>JSON.parse(files.get(key)!) } : null;
  const bucket = { get: async(key:string)=>object(key), list:async()=>({objects:[],truncated:false}), put:async(key:string,input:Uint8Array|string,opts:any)=> {
    if (key === 'resources/catalog/current.json') {
      if (opts.onlyIf.etagDoesNotMatch === '*' && files.has(key) || opts.onlyIf.etagMatches && opts.onlyIf.etagMatches !== String(version)) return null;
      version++;
    }
    files.set(key,typeof input === 'string' ? input : new TextDecoder().decode(input)); return object(key);
  } };
  env.AUDIO = bucket as unknown as R2Bucket;
  assert.deepEqual(await (await request('admin/cms/resources')).json(),{catalog:{schemaVersion:1,revision:0,resources:[]},etag:'*'});
  const catalog = {schemaVersion:1,revision:1,resources:[]}, body = {catalog,etag:'*',reason:'Initial empty catalog'};
  assert.equal((await request('admin/cms/resources','POST',body)).status,400);
  assert.equal(files.size,0);
  const response = await request('admin/cms/resources','POST',{...body,confirm:'apply'}); assert.equal(response.status,200,await response.clone().text());
  const saved = await response.json() as any; assert.equal(saved.state,'Published'); assert.equal(saved.kind,'resources'); assert.equal(saved.by.id,42);
  assert.equal((await request('admin/cms/resources','POST',{...body,confirm:'apply'})).status,409);
  const audit = await (await request('admin/cms/changes')).json() as any; assert.deepEqual(new Set(audit.changes.map((c:any)=>c.state)),new Set(['Failed','Published']));
  assert.deepEqual((await (await request('admin/cms/resources')).json() as any).catalog,catalog);
  assert.deepEqual((await (await request('admin/cms/resources/releases')).json() as any).releases,[]);
  assert.equal(fake.calls.length,0,'Resource publication must not contact GitHub');
});
