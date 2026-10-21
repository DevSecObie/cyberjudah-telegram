import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const output = await build({ stdin: { contents: 'export * from "./lib/plan"; export { planContent } from "./lib/reminders";', resolveDir: new URL('../src', import.meta.url).pathname }, tsconfig: new URL('../tsconfig.json', import.meta.url).pathname, bundle: true, write: false, format: 'esm', plugins: [{ name: 'plan-platform', setup(b) {
  b.onResolve({ filter: /^@\/tg\/(hooks|sdk)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
  b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path.endsWith('hooks') ? 'export const useStored = () => {};' : 'export const app = null; export const api = () => {}; export class ApiError extends Error {}' }));
} }] });
const { isCivilDate, getScheduledPlanDay, getPlanDayDate, planDays, planDay, planCompletion, startPlan, cataloguePlan, filterPlans, normalizePlanFilters, planContent } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const books = [{ slug: 'genesis', book: 'Genesis', chapterIds: [1, 2, 3, 4, 5], testament: 'Old Testament' }, { slug: 'john', book: 'John', chapterIds: [1, 2], testament: 'New Testament' }];

test('civil dates validate leap days and do not change day counts across DST or year boundaries', () => {
  assert.equal(isCivilDate('2024-02-29'), true); assert.equal(isCivilDate('2025-02-29'), false);
  assert.equal(isCivilDate('2026-02-31'), false); assert.equal(isCivilDate('2026-2-1'), false);
  assert.equal(getScheduledPlanDay('2026-03-07', '2026-03-09'), 3);
  assert.equal(getScheduledPlanDay('2026-10-31', '2026-11-02'), 3);
  assert.equal(getScheduledPlanDay('2026-12-31', '2027-01-01'), 2);
  assert.equal(getScheduledPlanDay('2026-10-01', '2026-09-30'), 0);
  assert.equal(getScheduledPlanDay('invalid', '2026-10-01'), undefined);
  assert.equal(getPlanDayDate('2024-02-28', 3), '2024-03-01');
  assert.equal(getPlanDayDate('2026-10-01', 0), undefined);
});

test('each day previews its own chapters and resumes the first unread day including a partial last day', () => {
  const plan = { ...startPlan(2), books: ['genesis'] };
  const days = planDays(plan, books, { genesis: '1-2,5' });
  assert.deepEqual(days.map(d => d.chapters.map(c => c.chapter)), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(days.map(d => d.done), [true, false, true]);
  assert.deepEqual(planCompletion(days), { completed: 2, resume: 1, finished: false });
  assert.deepEqual(planCompletion(planDays(plan, books, { genesis: '1-5' })), { completed: 3, resume: 3, finished: true });
  assert.deepEqual(planDay(plan, books, {}, 2).chapters.map(c => c.chapter), [5]);
  assert.deepEqual(planCompletion([]), { completed: 0, resume: 0, finished: false });
});

test('catalogue search matches every normalized word in titles and descriptions', () => {
  const plans = [{ name: 'Élie', description: 'The Law' }, { name: 'Psalms', description: 'Songs' }];
  assert.deepEqual(filterPlans(plans, { query: 'law ELIE', language: 'en' }).map(p => p.name), ['Élie']);
  assert.deepEqual(filterPlans(plans, { query: 'missing', language: 'all' }), []);
  assert.deepEqual(normalizePlanFilters(null, 'fr'), { query: '', language: 'en' });
});

test('selected books, pace and zero-based day stay compatible with reminder content', () => {
  const plan = cataloguePlan('new', books, 2);
  assert.deepEqual(plan.books, ['john']); assert.equal(plan.perDay, 2); assert.equal(plan.day, 0);
  const changed = { ...plan, startedAt: '2026-11-01', day: 1, seenCompleted: 1 };
  assert.deepEqual(planContent(changed), { books: ['john'], perDay: 2, day: 1 });
  assert.deepEqual(cataloguePlan('book:genesis', books, 4).books, ['genesis']);
  assert.equal(cataloguePlan('unknown', books, 1), null);
  assert.equal(cataloguePlan('whole', books, -1).perDay, 1);
});
