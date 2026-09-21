// Rebuild the static share card without runtime image generation or external font requests.
// Run from the repository root: node scripts/branding/render-og.mjs
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.goto(new URL('./og-card.html', import.meta.url).href);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((img) => img.decode()));
  });
  const output = new URL('../../public/og/aywa-v1.png', import.meta.url);
  await mkdir(new URL('../../public/og/', import.meta.url), { recursive: true });
  await page.screenshot({ path: fileURLToPath(output), type: 'png' });
  console.log('Rendered public/og/aywa-v1.png (1200 × 630)');
} finally {
  await browser.close();
}
