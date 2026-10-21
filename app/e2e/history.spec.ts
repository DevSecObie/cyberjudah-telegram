import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const DATA = process.env.VITE_DATA_ORIGIN || 'https://data.cyberjudah.io';
const fixture = async (path: string) => JSON.parse(await readFile(new URL(`../../bot/tests/fixtures/bs/api/${path}`, import.meta.url), 'utf8'));
async function setup(page: Page, theme = 'light') {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: theme === 'dark' ? 'dark' : 'light' });
  await page.addInitScript(theme => {
    if (!localStorage.getItem('history-fixture')) {
      localStorage.setItem('cj:hist', JSON.stringify([{ slug: 'genesis', chapter: 1, verse: 2, name: 'Genesis 1', at: Date.now() - 300000 }, { slug: 'john', chapter: 3, verse: 16, name: 'John 3', at: Date.now() - 3600000 }]));
      localStorage.setItem('history-fixture', '1');
    }
    localStorage.setItem('cj:bs', JSON.stringify({ preferredColorScheme: theme, preferredLightTheme: 'default', preferredDarkTheme: 'dark' }));
  }, theme);
  await page.route('https://telegram.org/**', r => r.fulfill({ contentType: 'application/javascript', body: '' }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, r => r.abort());
  await page.route(`${DATA}/**`, async r => {
    const path = new URL(r.request().url()).pathname;
    if (path === '/api/kjv/books.json') return r.fulfill({ json: await fixture('kjv/books.json') });
    if (path === '/api/kjv/genesis/1.json') return r.fulfill({ json: await fixture('kjv/genesis/1.json') });
    const number = path.match(/^\/api\/strongs\/([HG]\d+)\.json$/)?.[1];
    if (number) return r.fulfill({ json: { ...(await fixture('strongs/G3056.json')), number } });
    return r.fulfill({ status: 404, body: '' });
  });
}
const history = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('cj:hist') || '[]'));
for (const theme of ['light', 'dark']) test(`history and word study screenshots: ${theme}`, async ({ page }) => {
  await setup(page, theme);
  await page.goto('/lexicon/G3056');
  await expect(page.locator('.bs-word__lemma')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `e2e/review/history/${process.env.REVIEW_PHASE || 'after'}/${theme}-word-study-390.png` });
  await page.goto('/history');
  await expect(page.getByRole('link', { name: /Genesis 1:2/ })).toBeVisible();
  if (process.env.REVIEW_PHASE !== 'before') {
    await expect(page.getByText('Strong', { exact: true })).toBeVisible();
    const row = page.locator('.history-screen .row').first(), head = page.locator('.history-screen .head');
    const bounds = (await row.boundingBox())!, header = (await head.boundingBox())!;
    expect(bounds.x).toBe(0);
    expect(bounds.y).toBe(header.y + header.height);
    expect(bounds.height).toBeLessThan(90);
  }
  await page.screenshot({ path: `e2e/review/history/${process.env.REVIEW_PHASE || 'after'}/${theme}-history-390.png` });
});
test('a loaded Strong is recorded once per visit and revisiting moves it above Bible entries', async ({ page }) => {
  await setup(page);
  await page.goto('/lexicon/G3056');
  await expect(page.locator('.bs-word__lemma')).toBeVisible();
  await expect.poll(async () => (await history(page))[0]?.reference).toBe('G3056');
  await page.reload();
  await expect(page.locator('.bs-word__lemma')).toBeVisible();
  await expect.poll(async () => (await history(page)).length).toBe(3);
  await page.goto('/read/genesis/1');
  await expect(page.locator('#verset-1')).toBeVisible();
  await expect.poll(async () => (await history(page))[0]?.type).toBe('bible');
  await page.goto('/lexicon/G3056');
  await expect.poll(async () => (await history(page))[0]?.reference).toBe('G3056');
  await page.goto('/history');
  await expect(page.locator('.history-screen .row').first()).toContainText('Strong');
  await page.getByRole('link', { name: /Genesis 1:2/ }).click();
  await expect(page).toHaveURL(/\/read\/genesis\/1\?at=2$/);
});
test('clear names the count, cancel keeps the list, confirm shows the reference empty state', async ({ page }) => {
  await setup(page);
  await page.goto('/history');
  await expect(page.getByRole('link', { name: /Genesis 1:2/ })).toBeVisible();
  await page.getByRole('button', { name: 'Clear history', exact: true }).click();
  const confirm = page.getByRole('dialog');
  await expect(confirm).toContainText('Recently viewed items will be removed from this device (2).');
  await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('.history-screen .row')).toHaveCount(2);
  await page.getByRole('button', { name: 'Clear history', exact: true }).click();
  await confirm.getByRole('button', { name: 'Clear history', exact: true }).click();
  await expect(page.getByText('No recently viewed content.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Clear history', exact: true })).toHaveCount(0);
  expect(await history(page)).toEqual([]);
  await page.reload();
  await expect(page.getByText('No recently viewed content.', { exact: true })).toBeVisible();
});
test('future dictionary and topic producers have distinct chips and destinations in the flat list', async ({ page }) => {
  await setup(page);
  await page.addInitScript(() => localStorage.setItem('cj:hist', JSON.stringify([
    { type: 'topic', slug: 'faith', name: 'Faith', at: Date.now() - 10000 },
    { type: 'dictionary', slug: 'abraham', name: 'Abraham', dictionaryTitle: "Easton's Bible Dictionary", at: Date.now() - 30000 },
    { slug: 'genesis', chapter: 1, name: 'Genesis 1', at: Date.now() - 60000 },
  ])));
  await page.goto('/history');
  await expect(page.getByRole('link', { name: /Faith Topic/ })).toHaveAttribute('href', '/topics/faith');
  await expect(page.getByRole('link', { name: /Abraham.*Dictionary/ })).toHaveAttribute('href', '/dictionary/abraham');
  await expect(page.locator('.history-screen .row')).toHaveCount(3);
  await expect(page.getByRole('link', { name: /Genesis 1 KJV/ })).toHaveAttribute('href', '/read/genesis/1');
});
