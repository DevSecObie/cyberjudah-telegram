import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { buildBundle } from '../../resources/bundle.mjs';

// Bible Strong's update dot (MenuButton, MoreScreen, useAvailableUpdates): the Menu button shows a
// green dot for an update not yet seen in Downloads; the Downloads row shows one while any waits.
const origin = process.env.VITE_DATA_ORIGIN || 'https://data.cyberjudah.io';
const LAUNCH = '#tgWebAppData=query_id%3Dupdate-dot&tgWebAppVersion=9.1&tgWebAppPlatform=ios';
async function setup(page: Page) {
  const meta = { language: 'en', source: [{ url: 'https://example.invalid/fixture', revision: 'TEST ONLY', sha256: 'a'.repeat(64) }], license: [{ id: 'public-domain', url: 'https://example.invalid/fixture', attribution: 'Synthetic fixture notice.', modifications: '' }], approval: { reference: 'https://example.invalid/fixture', approvedBy: 'TEST ONLY' } };
  const strong = (version: string) => buildBundle({ ...meta, id: 'strongs', kind: 'lexicon', title: "Strong's synthetic fixture" }, [
    { key: 'index', data: [{ n: 'H430', lemma: 'fixture', xlit: 'fixture', def: `${version} definition`, count: 1 }] },
  ]);
  const old = await strong('Original'), next = await strong('Updated'), bundles = [old, next];
  let current = old;
  const mock = await readFile(new URL('./telegram-mock.js', import.meta.url), 'utf8');
  await page.route('https://telegram.org/**', (r) => r.fulfill({ contentType: 'application/javascript', body: mock }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, (r) => r.abort());
  await page.route(`${origin}/**`, (r) => r.fulfill({ json: {} }));
  await page.route('**/api/resources/**', (r) => {
    const url = new URL(r.request().url());
    if (url.pathname.endsWith('/catalog')) return r.fulfill({ json: { schemaVersion: 1, revision: current === old ? 1 : 2, resources: [current.entry] } });
    const bundle = bundles.find((b) => url.pathname.includes(`/${b.entry.id}/${b.entry.release}/`));
    const bytes = bundle?.files.get(url.pathname.split('/').at(-1)!);
    return bytes ? r.fulfill({ body: Buffer.from(bytes), contentType: 'application/json' }) : r.fulfill({ status: 404 });
  });
  return { update: () => { current = next; } };
}
const bar = (page: Page) => page.getByRole('navigation', { name: 'Sections' });

test('a new release shows the dot on Menu until Downloads is opened, and on the Downloads row until it is installed', async ({ page }) => {
  const fixture = await setup(page);
  await page.goto(`/resources${LAUNCH}`);
  const card = page.locator('.resource-card').filter({ hasText: "Strong's synthetic fixture" });
  await card.getByRole('button', { name: 'Install', exact: true }).click();
  await expect(card).toContainText('Available offline');
  await expect(bar(page).getByRole('button', { name: 'Main menu', exact: true })).toBeVisible();
  await expect(page.locator('.notify-dot')).toHaveCount(0);

  fixture.update();
  await page.goto(`/settings${LAUNCH}`);
  const menu = bar(page).getByRole('button', { name: 'Main menu, updates available', exact: true });
  await expect(menu).toBeVisible();
  await expect(menu.locator('.notify-dot')).toHaveCSS('width', '10px');
  await menu.click();
  const downloads = page.getByRole('link', { name: 'Downloads, updates available', exact: true });
  await expect(downloads.locator('.notify-dot')).toHaveCSS('width', '12px');
  await downloads.click();
  await expect(page).toHaveURL(/\/resources/);
  // Seen: the Menu dot goes, the Downloads row keeps its dot while the update waits.
  await expect(bar(page).getByRole('button', { name: 'Main menu', exact: true })).toBeVisible();
  await expect(bar(page).locator('.notify-dot')).toHaveCount(0);
  await page.goto(`/more${LAUNCH}`);
  await expect(page.getByRole('link', { name: 'Downloads, updates available', exact: true })).toBeVisible();
  await page.goto(`/resources${LAUNCH}`);
  await card.getByRole('button', { name: 'Install update' }).click();
  await expect(card.getByRole('button', { name: 'Roll back' })).toBeEnabled();
  await page.goto(`/more${LAUNCH}`);
  await expect(page.getByRole('link', { name: 'Downloads', exact: true })).toBeVisible();
  await expect(page.locator('.notify-dot')).toHaveCount(0);
});
