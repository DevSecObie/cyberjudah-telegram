import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const out = new URL('./.build/app-study-research-test.mjs', import.meta.url).pathname;
await build({ entryPoints: [new URL('../src/app-study-research.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile: out, logLevel: 'error', plugins: [{ name: 'teachings', setup(b) {
  b.onResolve({ filter: /^\.\/teachings$/ }, () => ({ path: 'teachings', namespace: 'fixture' }));
  b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'js', contents: `export async function searchTeachings(env,q) { env.queries.push(q); return {ok:true,hits:[{title:'The recorded lesson',feed:'class',video:'abcdefghijk',start:120,note:'/classes/lesson',date:'2026-01-01',excerpt:'The teacher actually said these recorded words in the class.'}]}; } export async function transcriptAround(env,video,t) { env.windows.push({video,t}); return {ok:true,title:'The recorded lesson',url:'/classes/lesson',date:'2026-01-01',chunks:[{t:100,text:'The original transcript context before the cited moment.'},{t:120,text:'The teachers words at the cited moment.'},{t:140,text:'The surrounding explanation after that moment.'}]}; }` }));
} }] });
const { createAppResearch, parseResearchPlan } = await import(out);
test('plans reject private data and arbitrary tools, with a bounded public resource list', () => {
  assert.deepEqual(parseResearchPlan('{"searches":[{"resource":"private-notes","query":"all"}]}'), []);
  assert.deepEqual(parseResearchPlan('{"searches":[{"resource":"fetch-url","query":"https://evil.test"}]}'), []);
  assert.equal(parseResearchPlan('{"searches":[{"resource":"transcripts","query":"Abraham"},{"resource":"jewish-encyclopedia","query":"Abraham"}]}').length, 2);
});
test('transcript research carries actual words, surrounding context and video timestamps', async () => {
  const env = { queries: [], windows: [] }, events = [];
  const research = createAppResearch(env, [], event => events.push(event));
  await research.search([{ resource: 'transcripts', query: 'Abraham' }]);
  assert.deepEqual(env.queries, ['Abraham']);
  assert.deepEqual(env.windows, [{ video: 'abcdefghijk', t: 120 }]);
  assert.equal(research.sources.length, 2);
  assert.ok(research.sources.every(s => s.evidence === 'teaching' && s.kind === 'spoken' && s.video === 'abcdefghijk'));
  assert.equal(research.sources[0].t, 120);
  assert.equal(research.sources[1].t, 100);
  assert.match(research.sources[1].text, /surrounding explanation/);
  assert.ok(events.some(e => /transcript.*2:00/.test(e.status)));
});
