import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { buildBundle } from '../../resources/bundle.mjs';
const origin = process.env.VITE_DATA_ORIGIN || 'https://data.cyberjudah.io';
const revision = 'a'.repeat(64);
const book = { book: 'Obadiah', slug: 'obadiah', chapters: 1, verses: 2, testament: 'Old Testament', url: '/bible/obadiah', chapterIds: [1] };
const verses = [1, 2].map((verse) => ({ slug: 'obadiah', book: 'Obadiah', chapter: 1, verse, text: `Synthetic occurrence ${verse}.`, words: [] }));
async function setup(page: Page) {
  const meta = { language: 'en', source: [{ url: 'https://example.invalid/fixture', revision: 'TEST ONLY', sha256: 'a'.repeat(64) }], license: [{ id: 'public-domain', url: 'https://example.invalid/fixture', attribution: 'Synthetic fixture notice.', modifications: '' }], approval: { reference: 'https://example.invalid/fixture', approvedBy: 'TEST ONLY' } };
  const strong = async (version: string) => buildBundle({ ...meta, id: 'strongs', kind: 'lexicon', title: "Strong's synthetic fixture" }, [
    { key: 'entry/H430', data: { number: 'H430', language: 'Hebrew', lemma: 'fixture', xlit: 'fixture', pron: '', derivation: '', def: `${version} definition.`, kjv: '', count: 2, verses: 2, words: [], occurrences: [verses[0]], occurrencePages: { revision, pageSize: 1, pages: 2, nextPage: 1 }, source: 'Unchanged fixture attribution.' } },
    { key: `occurrences/H430/${revision}/1`, data: { number: 'H430', revision, page: 1, total: 2, occurrences: [verses[1]], nextPage: null } },
    { key: 'index', data: [{ n: 'H430', lemma: 'fixture', xlit: 'fixture', def: `${version} definition`, count: 25 }] },
  ]);
  const reference = await buildBundle({ ...meta, id: 'josephus', kind: 'reference', title: 'Josephus synthetic fixture (1905)' }, [
    { key: 'pages', data: [{ key: 'page/1/1', volume: 1, page: 1, image: 1, title: 'Synthetic page one' }] },
    { key: 'page/1/1', data: { title: 'Synthetic page one', volume: 1, page: 1, image: 1, text: 'Synthetic reference: Obadiah 1:1.', scan: 'https://example.invalid/scan', links: [{ start: 21, end: 32, slug: 'obadiah', chapter: 1, verse: 1, label: 'Obadiah 1:1' }] } },
    { key: 'search/synthetic', data: { keys: ['page/1/1'], total: 1 } },
  ]);
  const old = await strong('Original'), next = await strong('Updated'), bundles = [old, next, reference];
  let current = old, corrupt = false;
  const mock = await readFile(new URL('./telegram-mock.js', import.meta.url), 'utf8');
  await page.route('https://telegram.org/**', (r) => r.fulfill({ contentType: 'application/javascript', body: mock }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, (r) => r.abort());
  await page.route(`${origin}/**`, (r) => r.fulfill({ json: new URL(r.request().url()).pathname === '/api/kjv/books.json' ? [book] : {} }));
  await page.route('**/api/resources/**', (r) => {
    const url = new URL(r.request().url());
    if (url.pathname.endsWith('/catalog')) return r.fulfill({ json: { schemaVersion: 1, revision: current === old ? 1 : 2, resources: [current.entry, reference.entry] } });
    const bundle = bundles.find((b) => url.pathname.includes(`/${b.entry.id}/${b.entry.release}/`));
    if (!bundle) return r.fulfill({ status: 404 });
    if (url.pathname.endsWith('/record')) {
      const rows = bundle.manifest.parts.flatMap((p) => new TextDecoder().decode(bundle.files.get(p.path)).trim().split('\n').map((line) => JSON.parse(line)));
      const row = rows.find((r) => r.key === url.searchParams.get('key'));
      return row ? r.fulfill({ json: { release: bundle.entry.release, data: row.data } }) : r.fulfill({ status: 404 });
    }
    const name = url.pathname.split('/').at(-1)!, bytes = bundle.files.get(name);
    return bytes ? r.fulfill({ body: corrupt && bundle === next && name.endsWith('.ndjson') ? Buffer.from('damaged') : Buffer.from(bytes), contentType: 'application/json' }) : r.fulfill({ status: 404 });
  });
  return { old, next, reference, update: () => { current = next; }, corrupt: (value: boolean) => { corrupt = value; } };
}
test('installer rejects damage, updates, rolls back and removes only its own data', async ({ page }) => {
  const fixture = await setup(page);
  await page.goto('/resources');
  const strong = page.locator('.resource-card').filter({ hasText: "Strong's synthetic fixture" });
  const reference = page.locator('.resource-card').filter({ hasText: 'Josephus synthetic fixture' });
  for (const card of [strong, reference]) { await card.getByRole('button', { name: 'Install', exact: true }).click(); await expect(card).toContainText('Available offline'); }
  await strong.getByRole('button', { name: /Strong's synthetic/ }).click();
  await expect(page.getByRole('dialog')).toContainText('Synthetic fixture notice');
  await page.getByRole('button', { name: 'Close', exact: true }).last().click();
  fixture.update(); fixture.corrupt(true);
  await page.getByRole('button', { name: 'Refresh catalog' }).click();
  await strong.getByRole('button', { name: 'Install update' }).click();
  await expect(strong).toContainText('The change could not finish');
  await page.goto('/lexicon/H430'); await expect(page.locator('.bs-word')).toContainText('Original definition');
  fixture.corrupt(false);
  await page.goto('/resources'); await strong.getByRole('button', { name: 'Install update' }).click();
  await expect(strong.getByRole('button', { name: 'Roll back' })).toBeEnabled();
  await page.goto('/lexicon/H430'); await expect(page.locator('.bs-word')).toContainText('Updated definition');
  await page.goto('/resources'); await strong.getByRole('button', { name: 'Roll back' }).click();
  await expect(strong).toContainText('Previous release restored');
  await page.goto('/lexicon/H430'); await expect(page.locator('.bs-word')).toContainText('Original definition');
  await page.goto('/resources'); await strong.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(strong).toContainText('Removed from this device'); await expect(reference).toContainText('Available offline');
  const stored = await page.evaluate(async () => { const request = indexedDB.open('cj-resources-v1'); const db = await new Promise<IDBDatabase>((resolve) => { request.onsuccess = () => resolve(request.result); }); const r = db.transaction('releases').objectStore('releases').getAll(); const rows = await new Promise<{ id: string }[]>((resolve) => { r.onsuccess = () => resolve(r.result); }); db.close(); return rows.map((r) => r.id); });
  expect(stored).not.toContain('strongs'); expect(stored).toContain('josephus');
});
test('installed words and reference pages work with unavailable resource APIs', async ({ page }) => {
  const fixture = await setup(page);
  await page.goto('/resources');
  for (const name of ["Strong's synthetic fixture", 'Josephus synthetic fixture']) {
    const card = page.locator('.resource-card').filter({ hasText: name });
    await card.getByRole('button', { name: 'Install', exact: true }).click(); await expect(card).toContainText('Available offline');
  }
  await page.route('**/api/resources/**', (r) => r.abort());
  await page.goto('/lexicon/H430');
  await expect(page.locator('.bs-word')).toContainText('Original definition');
  await page.getByRole('button', { name: 'Load more verses', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Every verse', exact: true })).toBeVisible();
  await expect(page.locator('.bs-word')).toContainText('Synthetic occurrence 2');
  await expect(page.locator('.bs-word__src')).toHaveText('Unchanged fixture attribution.');
  await page.goto(`/resources/josephus/${fixture.reference.entry.release}?key=page/1/1`);
  await expect(page.locator('.resource-reader__text')).toHaveText('Synthetic reference: Obadiah 1:1.');
  await expect(page.locator('.resource-reader__text a')).toHaveAttribute('href', '/read/obadiah/1?v=1');
});

test('Ask sends the installed release even after the published catalog advances', async ({ page }) => {
  const f = await setup(page);
  await page.goto('/resources');
  const card = page.locator('.resource-card').filter({ hasText: "Strong's synthetic fixture" });
  await card.getByRole('button', { name: 'Install', exact: true }).click(); await expect(card).toContainText('Available offline');
  f.update();
  await page.route('**/api/ask', (r) => r.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ delta: 'Synthetic test answer.' }) + '\n' + JSON.stringify({ done: true, sources: [] }) + '\n' }));
  await page.goto('/ask#tgWebAppData=' + encodeURIComponent(new URLSearchParams({ user: JSON.stringify({ id: 42, first_name: 'Test' }), auth_date: '0', hash: 'synthetic' }).toString()) + '&tgWebAppPlatform=ios');
  await expect(page.locator('textarea')).toBeEditable();
  const request = page.waitForRequest((r) => new URL(r.url()).pathname === '/api/ask' && r.method() === 'POST');
  await page.locator('textarea').fill('What does this word mean?');
  await page.locator('textarea').press('Enter');
  const sent = (await request).postDataJSON();
  expect(sent.resources.strongs).toBe(f.old.entry.release);
  expect(sent.resources.josephus).toBe(f.reference.entry.release);
  expect(sent.resources['jewish-encyclopedia']).toBe(null);
});

test.describe('offline installed lexicon', () => {
  test.use({ serviceWorkers: 'allow' });
  test('cold launch reads an installed word and its continuation with no network', async ({ page, context, browserName }) => {
    test.skip(browserName === 'webkit' && process.platform === 'linux', 'Linux WebKit offline navigation fails independently of the app; see Phase 1 platform report.');
    await setup(page);
    await page.goto('/resources');
    const card = page.locator('.resource-card').filter({ hasText: "Strong's synthetic fixture" });
    await card.getByRole('button', { name: 'Install', exact: true }).click(); await expect(card).toContainText('Available offline');
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await context.unrouteAll({ behavior: 'wait' });
    await page.unrouteAll({ behavior: 'wait' });
    await context.setOffline(true); await page.close();
    const reopened = await context.newPage();
    await reopened.goto('/lexicon/H430');
    await expect(reopened.locator('.bs-word')).toContainText('Original definition');
    await reopened.getByRole('button', { name: 'Load more verses', exact: true }).click();
    await expect(reopened.getByRole('heading', { name: 'Every verse', exact: true })).toBeVisible();
    await expect(reopened.locator('.bs-word')).toContainText('Synthetic occurrence 2');
  });
});
