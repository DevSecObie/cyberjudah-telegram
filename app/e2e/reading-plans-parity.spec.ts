import { expect, test, type Page } from '@playwright/test';
const DATA = process.env.VITE_DATA_ORIGIN || 'https://data.cyberjudah.io';
const books = [{ book: 'Genesis', slug: 'genesis', testament: 'Old Testament', chapters: 50, verses: 1533, chapterIds: Array.from({ length: 50 }, (_, i) => i + 1) }, { book: 'Exodus', slug: 'exodus', testament: 'Old Testament', chapters: 40, verses: 1213, chapterIds: Array.from({ length: 40 }, (_, i) => i + 1) }, { book: 'John', slug: 'john', testament: 'New Testament', chapters: 21, verses: 879, chapterIds: Array.from({ length: 21 }, (_, i) => i + 1) }];
async function setup(page: Page, theme = 'light', chapters = books) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: theme === 'dark' ? 'dark' : 'light' });
  await page.addInitScript(theme => {
    if (!localStorage.getItem('plan-fixture')) {
      localStorage.setItem('cj:plan', JSON.stringify({ name: 'Whole Bible with Apocrypha', catalogId: 'whole', books: ['genesis', 'exodus'], startedAt: '2026-10-01', day: 0, perDay: 2, streak: 0, seenCompleted: 0 }));
      localStorage.setItem('cj:read', '{}');
      localStorage.setItem('plan-fixture', '1');
    }
    localStorage.setItem('cj:bs', JSON.stringify({ preferredColorScheme: theme, preferredLightTheme: 'default', preferredDarkTheme: 'dark' }));
  }, theme);
  await page.route('https://telegram.org/**', r => r.fulfill({ contentType: 'application/javascript', body: '' }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, r => r.abort());
  await page.route(`${DATA}/**`, r => {
    const path = new URL(r.request().url()).pathname;
    if (path.endsWith('/api/kjv/books.json')) return r.fulfill({ json: chapters });
    if (/\/api\/kjv\/[^/]+\/\d+\.json/.test(path)) return r.fulfill({ json: { book: path.split('/')[3], chapter: Number(path.split('/')[4].replace('.json', '')), translation: 'KJV', verses: [{ verse: 1, text: 'In the beginning God created the heaven and the earth.' }] } });
    return r.fulfill({ status: 404, body: '' });
  });
}
for (const theme of ['light', 'dark']) test(`reading plan screenshots: ${theme}`, async ({ page }) => {
  await setup(page, theme);
  await page.goto('/plan');
  await expect(page.getByRole('link', { name: 'Genesis 1', exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `e2e/review/reading-plans/${process.env.REVIEW_PHASE || 'after'}/${theme}-plan-390.png` });
  await page.goto('/plans');
  await expect(page.getByRole('heading', { name: 'Reading plans', exact: true })).toBeVisible();
  await expect(page.getByText('New Testament', { exact: true }).first()).toBeVisible();
  await expect(page.locator('.reading-catalogue .list')).toHaveCount(0);
  const card = page.locator('.reading-catalogue__card').first();
  await expect(card).toHaveCSS('border-radius', '20px');
  await expect(card).toHaveCSS('padding', '16px');
  await expect(card).toHaveCSS('margin-bottom', '12px');
  await expect(card).toHaveCSS('background-color', theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(18, 45, 66)');
  await expect(page.locator('.reading-catalogue')).toHaveCSS('background-color', theme === 'light' ? 'rgb(244, 247, 255)' : 'rgb(30, 61, 82)');
  await expect(card.locator('.row')).toHaveCSS('gap', '16px');
  await expect(card.locator('.reading-catalogue__image')).toHaveCSS('width', '96px');
  await expect(card.locator('.reading-catalogue__image')).toHaveCSS('height', '64px');
  await expect(card.locator('.reading-catalogue__image')).toHaveCSS('border-radius', '14px');
  await expect(card.locator('.row__title')).toHaveCSS('font-size', '16px');
  await expect(card.locator('.row__title')).toHaveCSS('font-weight', '700');
  await expect(card.locator('.row__sub')).toHaveCSS('font-size', '13px');
  await expect(card.locator('.row__sub > b')).toHaveCSS('font-weight', '700');
  await expect(page.getByRole('heading', { name: 'English', exact: true })).toHaveCSS('font-size', '14px');
  await expect(page.getByRole('heading', { name: 'English', exact: true })).toHaveCSS('font-weight', '700');
  await page.screenshot({ path: `e2e/review/reading-plans/${process.env.REVIEW_PHASE || 'after'}/${theme}-catalogue-390.png` });
});

test('chevrons, date picker and day preview reach the whole plan without moving its reminder day', async ({ page }) => {
  await setup(page);
  await page.goto('/plan');
  await expect(page.getByRole('heading', { name: 'Day 1 of 45', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Previous day', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Next day', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Genesis 3', exact: true })).toBeVisible();
  await page.getByLabel('Choose a reading date', { exact: true }).fill('2026-11-14');
  await expect(page.getByRole('heading', { name: 'Day 45 of 45', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Exodus 40', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next day', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('cj:plan')!).day)).toBe(0);
  await page.getByLabel('Choose a reading date', { exact: true }).fill('2026-10-01');
  await page.getByRole('checkbox', { name: 'Genesis 1', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Congratulations', exact: true })).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Genesis 2', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Congratulations', exact: true })).toContainText('You have just finished your reading.');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Day 1 of 45', exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('cj:plan')!).day)).toBe(1);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Day 2 of 45', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Congratulations', exact: true })).toHaveCount(0);
});

test('opening the last chapter celebrates completion only when the plan comes back', async ({ page }) => {
  await setup(page, 'light', [{ ...books[0], chapters: 2, chapterIds: [1, 2] }]);
  await page.goto('/plan');
  await page.getByRole('checkbox', { name: 'Genesis 1', exact: true }).click();
  await page.getByRole('link', { name: 'Genesis 2', exact: true }).click();
  await expect(page).toHaveURL(/\/read\/genesis\/2/);
  await expect(page.getByRole('dialog', { name: 'Congratulations', exact: true })).toHaveCount(0);
  await page.goBack();
  const success = page.getByRole('dialog', { name: 'Congratulations', exact: true });
  await expect(success).toContainText('You have completed this plan !');
  await expect(success.locator('svg')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(success).toBeVisible();
  await success.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText('Journey completed', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Read again', exact: true })).toBeVisible();
  await expect(success).toHaveCount(0);
});

test('changing the start date preserves reminder fields and stopping preserves completed chapters', async ({ page }) => {
  await setup(page);
  await page.goto('/plan');
  await page.getByRole('checkbox', { name: 'Genesis 1', exact: true }).click();
  await page.getByRole('button', { name: 'Plan options', exact: true }).click();
  await page.getByRole('button', { name: 'Change start date', exact: true }).click();
  await page.getByLabel('Start date', { exact: true }).fill('2026-11-01');
  const plan = await page.evaluate(() => JSON.parse(localStorage.getItem('cj:plan')!));
  expect(plan).toMatchObject({ startedAt: '2026-11-01', day: 0, perDay: 2, books: ['genesis', 'exodus'] });
  const stop = async () => { await page.getByRole('button', { name: 'Plan options', exact: true }).click(); await page.getByRole('button', { name: 'Stop this plan', exact: true }).click(); };
  await stop();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Day 1 of 45', exact: true })).toBeVisible();
  await stop();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page).toHaveURL(/\/plans$/);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('cj:plan')!))).toBeNull();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('cj:read')!))).toMatchObject({ genesis: '1' });
});

test('catalogue URL search keeps the active journey visible and an explicit preview keeps the selected books and pace', async ({ page }) => {
  await setup(page);
  await page.goto('/plans?search=matthew%20revelation');
  await expect(page.getByRole('link', { name: /New Testament/ })).toBeVisible();
  await expect(page.locator('.reading-catalogue__card')).toHaveCount(2);
  await expect(page.getByRole('heading', { name: 'Your journeys', exact: true })).toBeVisible();
  await page.goto('/plan?catalog=new&pace=2');
  await expect(page.getByRole('heading', { name: 'Day 1 of 11', exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await page.getByRole('button', { name: 'Next day', exact: true }).click();
  await expect(page.getByRole('link', { name: 'John 3', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Start this plan', exact: true }).click();
  await page.getByRole('dialog').filter({ hasText: 'Switch to New Testament?' }).getByRole('button', { name: 'Start this plan', exact: true }).click();
  await expect(page).toHaveURL(/\/read\/john\/1/);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('cj:plan')!))).toMatchObject({ catalogId: 'new', books: ['john'], perDay: 2, day: 0 });
});

for (const theme of ['light', 'dark']) test(`catalogue controls: ${theme} removes Filter and pace, keeps journeys and single-book study`, async ({ page }) => {
  await setup(page, theme);
  await page.goto('/plans');
  await expect(page.getByRole('heading', { name: 'Reading plans', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Filter|active filters/ })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Chapters each day', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Your journeys', exact: true })).toBeVisible();
  const saved = await page.evaluate(() => ({ plan: localStorage.getItem('cj:plan'), progress: localStorage.getItem('cj:read') }));
  await expect(page.getByRole('link', { name: /Continue my journey/ }).first()).toHaveAttribute('href', '/plan');
  const preview = page.getByRole('link', { name: /New Testament/ });
  await expect(preview).toHaveAttribute('href', '/plan?catalog=new&pace=1');
  await preview.click();
  await expect(page.getByRole('heading', { name: 'Day 1 of 21', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next day', exact: true }).click();
  await expect(page.getByRole('link', { name: 'John 2', exact: true })).toBeVisible();
  await page.goBack();
  await page.getByRole('combobox', { name: 'Choose a book', exact: true }).selectOption('exodus');
  await page.getByRole('button', { name: 'Explore this plan', exact: true }).click();
  await expect(page).toHaveURL(u => u.searchParams.get('catalog') === 'book:exodus' && u.searchParams.get('pace') === '1');
  await expect(page.getByRole('heading', { name: 'Day 1 of 40', exact: true })).toBeVisible();
  expect(await page.evaluate(() => ({ plan: localStorage.getItem('cj:plan'), progress: localStorage.getItem('cj:read') }))).toEqual(saved);
});

test('starting a catalogue plan uses pace one without changing existing completed chapters', async ({ page }) => {
  await setup(page);
  await page.addInitScript(() => localStorage.setItem('cj:read', JSON.stringify({ genesis: '1', exodus: '2' })));
  await page.goto('/plans');
  const progress = await page.evaluate(() => JSON.parse(localStorage.getItem('cj:read')!));
  await page.getByRole('link', { name: /New Testament/ }).click();
  await expect(page.getByRole('heading', { name: 'Day 1 of 21', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Start this plan', exact: true }).click();
  await page.getByRole('dialog').filter({ hasText: 'Switch to New Testament?' }).getByRole('button', { name: 'Start this plan', exact: true }).click();
  await expect(page).toHaveURL(/\/read\/john\/1/);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('cj:plan')!))).toMatchObject({ catalogId: 'new', books: ['john'], perDay: 1, day: 0 });
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('cj:read')!))).toMatchObject(progress);
});

for (const theme of ['light', 'dark']) test(`plan completion screenshot: ${theme}`, async ({ page }) => {
  await setup(page, theme, [{ ...books[0], chapters: 2, chapterIds: [1, 2] }]);
  await page.goto('/plan');
  if (process.env.REVIEW_PHASE === 'before') {
    await page.getByRole('button', { name: 'Genesis 1 read', exact: true }).click();
    await page.getByRole('button', { name: 'Genesis 2 read', exact: true }).click();
    await expect(page.getByText('Day 1 done. Well read.', { exact: false })).toBeVisible();
  } else {
    await page.getByRole('checkbox', { name: 'Genesis 1', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Genesis 2', exact: true }).click();
    const success = page.getByRole('dialog', { name: 'Congratulations', exact: true });
    await expect(success).toContainText('You have completed this plan !');
    await expect(success.locator('svg')).toBeVisible();
  }
  await page.screenshot({ path: `e2e/review/reading-plans/${process.env.REVIEW_PHASE || 'after'}/${theme}-completion-390.png` });
});
