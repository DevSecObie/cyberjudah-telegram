import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { readingSummary } from '../../shared/reading.mjs';
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
