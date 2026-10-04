// The browser implements luminance masks; CairoSVG only renders alpha masks.
import { chromium } from 'playwright';
import fs from 'node:fs';
const output = new URL('../../app/public/icons/', import.meta.url);
const browser = await chromium.launch({ channel: 'chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
  const svg = fs.readFileSync(new URL('monochrome.svg', output)).toString('base64');
  await page.setContent(`<style>html,body{margin:0;background:transparent}img{display:block;width:512px;height:512px}</style><img alt="CyberJudah" src="data:image/svg+xml;base64,${svg}">`);
  await page.locator('img').evaluate(image => image.decode());
  await page.screenshot({ path: new URL('monochrome-512.png', output).pathname, omitBackground: true });
} finally { await browser.close(); }
