import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { readingSummary } from '../../shared/reading.mjs';
for (const scheme of ['light', 'dark']) test(`reader tracking controls match the ${scheme} reader and preserve mark/undo`, async ({ page }) => {
  const mock = fs.readFileSync(new URL('./telegram-mock.js', import.meta.url), 'utf8').replace('colorScheme: "dark"', `colorScheme: "${scheme}"`);
  await page.route('https://telegram.org/**', r => r.fulfill({ contentType: 'application/javascript', body: mock }));
  await page.route('https://data.cyberjudah.io/**', r => r.fulfill({ json: {} }));
  await page.route('**/api/kjv/books.json', r => r.fulfill({ json: [{ slug: 'genesis', book: 'Genesis', chapters: 50, chapterIds: [1, 2, 3, 4] }] }));
  await page.route('**/api/kjv/genesis/1.json', r => r.fulfill({ json: { book: 'Genesis', chapter: 1, verses: [{ verse: 1, text: 'In the beginning God created the heaven and the earth.' }, { verse: 2, text: 'And the earth was without form, and void; and darkness was upon the face of the deep. And the Spirit of God moved upon the face of the waters.' }, { verse: 3, text: 'And God said, Let there be light: and there was light.' }] } }));
  let read = false;
  await page.route('**/api/reading**', r => {
    if (r.request().method() === 'POST') read = r.request().postDataJSON().read;
    return r.fulfill({ json: { chapters: [{ slug: 'genesis', chapter: 1, read }] } });
  });
  await page.setViewportSize({ width: scheme === 'light' ? 320 : 390, height: 780 });
  await page.goto('/read/genesis/1#tgWebAppData=test&tgWebAppVersion=9.1&tgWebAppPlatform=ios');
  const action = page.getByRole('button', { name: 'Mark chapter read', exact: true });
  await expect(action).toBeEnabled();
  await expect(action).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(action.locator('svg')).toHaveAttribute('stroke-width', '2');
  await page.screenshot({ path: test.info().outputPath(`reader-${scheme}.png`), animations: 'disabled' });
  await action.click();
  const undo = page.getByRole('button', { name: 'Undo chapter read today' });
  await expect(undo).toHaveAttribute('aria-pressed', 'true');
  expect(read).toBe(true);
  await undo.click();
  await expect(action).toHaveAttribute('aria-pressed', 'false');
  expect(read).toBe(false);
  await page.getByRole('button', { name: 'Reading tracker', exact: true }).click();
  await expect(page).toHaveURL(/\/plan/);
});

test('four chapters, undo, reminder opt-in and pause persist after reload', async ({ page }) => {
  const mock = fs.readFileSync(new URL('./telegram-mock.js', import.meta.url), 'utf8');
  await page.route('https://telegram.org/**', r => r.fulfill({ contentType: 'application/javascript', body: mock }));
  const catalog = Array.from({ length: 8 }, (_, i) => ({ slug: 'genesis', book: 'Genesis', chapter: i + 1 }));
  let logs: { slug: string; chapter: number; day: string }[] = [];
  let settings = { enabled: false, weekly: false, time: '08:00', timezone: 'America/New_York' };
  await page.route('**/api/reading**', async route => {
    const req = route.request();
    if (req.url().endsWith('/chapter')) { const b = req.postDataJSON(); logs = logs.filter(r => r.chapter !== b.chapter); if (b.read) logs.push({ slug: b.slug, chapter: b.chapter, day: '2026-09-28' }); }
    if (req.url().endsWith('/settings')) settings = req.postDataJSON();
    await route.fulfill({ json: { ...readingSummary(catalog, logs, '2026-09-28'), settings, quote: { text: 'Study, Pray, Apply!' } } });
  });
  await page.goto('/plan#tgWebAppData=test&tgWebAppVersion=9.1&tgWebAppPlatform=ios');
  await expect(page.getByText('0 of 4 chapters')).toBeVisible();
  await expect(page.getByText('Bishop Nathanyel', { exact: true })).toBeVisible();
  for (let i = 1; i <= 4; i++) await page.getByRole('button', { name: `Mark read Genesis ${i}`, exact: true }).click();
  await expect(page.getByText('4 of 4 chapters')).toBeVisible();
  await page.getByRole('button', { name: 'Undo Genesis 4', exact: true }).click();
  await expect(page.getByText('3 of 4 chapters')).toBeVisible();
  await page.getByLabel('Remind me to read four chapters daily').check();
  await page.getByLabel('Monday recap of the previous seven days').check();
  await page.getByRole('button', { name: 'Save reminder settings' }).click();
  await expect(page.getByRole('status')).toContainText('saved');
  expect(settings.enabled).toBe(true);
  await page.reload();
  await expect(page.getByText('3 of 4 chapters')).toBeVisible();
  await expect(page.getByLabel('Remind me to read four chapters daily')).toBeChecked();
  await page.getByLabel('Remind me to read four chapters daily').uncheck();
  await page.getByLabel('Monday recap of the previous seven days').uncheck();
  await page.getByRole('button', { name: 'Save reminder settings' }).click();
  await expect(page.getByRole('status')).toContainText('saved');
  expect(settings.enabled).toBe(false); expect(settings.weekly).toBe(false);
  await page.screenshot({ path: test.info().outputPath('tracker.png'), fullPage: true });
});
