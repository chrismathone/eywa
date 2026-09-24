// Read-only browser verification of the standalone mockup; no application or DB access.
/* eslint-disable @typescript-eslint/no-require-imports -- Standalone CommonJS script run directly by Node. */
const { chromium } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function verify() {
  const output = path.join(__dirname, 'screenshots');
  fs.mkdirSync(output, { recursive: true });
  let executablePath = process.env.MCS_PREVIEW_BROWSER;
  if (!executablePath && process.platform === 'win32') {
    const cache = path.join(process.env.LOCALAPPDATA, 'ms-playwright');
    const versions = fs.readdirSync(cache).filter(n => /^chromium_headless_shell-\d+$/.test(n)).sort().reverse();
    if (versions.length) executablePath = path.join(cache, versions[0], 'chrome-headless-shell-win64/chrome-headless-shell.exe');
  }
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(pathToFileURL(path.join(__dirname, 'index.html')).href);
    await page.evaluate(() => document.fonts.ready);
    await page.locator('[data-filter="behind"]').click();
    assert.equal(await page.locator('#content .student-name').count(), 2);
    await page.locator('[data-filter="all"]').click();
    await page.locator('#student-search').fill('김도윤');
    assert.equal(await page.locator('#content .student-name').count(), 1);
    await page.locator('#student-search').fill('없는학생');
    assert.equal(await page.locator('#content .empty').count(), 1);
    await page.locator('#student-search').fill('');
    await page.locator('[data-student="s2"]').first().click();
    assert.equal(await page.evaluate(() => state.view), 4);
    assert.equal(await page.locator('#content .focus-title h2').innerText(), '김도윤');
    await page.locator('#content .focus-title [data-edit="s2"]').click();
    assert.equal(await page.locator('#goal-scope').inputValue(), 's2');
    await page.locator('#goal-total').fill('60');
    await page.locator('#goal-end').fill('2026-12-31');
    await page.locator('button[type="submit"]').click();
    const individual = await page.evaluate(() => ({
      total: state.configs.s2.total, other: state.configs.s1.total,
      actual: STUDENTS.find(s => s.id === 's2').actual, plan: model(STUDENTS[1]).plan,
    }));
    assert.equal(individual.total, 60);
    assert.equal(individual.other, 48);
    assert.equal(individual.actual, 15);
    assert.equal(individual.plan.at(-1).target, 60);
    assert.ok(individual.plan.every((p, i, a) => !i || p.target >= a[i - 1].target));
    assert.ok(individual.plan.every(p => !['2026-09-24', '2026-09-26', '2026-10-03'].includes(p.date)));
    await page.locator('#open-goal').click();
    await page.locator('#goal-total').fill('72');
    await page.locator('#goal-end').fill('2026-12-19');
    await page.locator('button[type="submit"]').click();
    assert.equal(await page.evaluate(() => Object.values(state.configs).every(g => g.total === 72)), true);
    assert.deepEqual(await page.evaluate(() => STUDENTS.map(s => s.actual)), [20, 15, 26, 17, 21, 24]);
    await page.locator('#open-goal').click();
    await page.locator('#goal-end').fill('2026-01-01');
    await page.locator('button[type="submit"]').click();
    assert.equal(await page.locator('#goal-dialog').evaluate(e => e.open), true);
    assert.equal(await page.locator('#goal-error').isVisible(), true);
    await page.keyboard.press('Escape');
    await page.locator('#reset-demo').click();
    await page.locator('[data-view="3"]').click();
    assert.equal(await page.locator('.calendar-table th.current-day').count(), 1);
    assert.equal(await page.locator('.calendar-table th[data-date="2026-09-24"]').count(), 0);
    await page.locator('[data-month="-1"]').click();
    assert.equal(await page.evaluate(() => state.month), '2026-08');
    await page.locator('[data-month="today"]').click();
    await page.locator('[data-view="4"]').click();
    await page.locator('[data-select="s3"]').click();
    assert.equal(await page.locator('#content .focus-title h2').innerText(), '박서윤');
    await page.locator('[data-view="4"]').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => state.view), 5);
    await page.evaluate(() => { state.selected = 's2'; document.querySelector('#toast').textContent = ''; });
    for (const width of [1440, 1024, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      for (let view = 1; view <= 5; view++) {
        await page.locator(`[data-view="${view}"]`).click();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0, `overflow at ${width} / ${view}`);
        if (width !== 1024) await page.screenshot({ path: path.join(output, `${width === 390 ? 'mobile' : 'desktop'}-${view}.png`), fullPage: true });
      }
    }
    await page.locator('#open-goal').click();
    await page.screenshot({ path: path.join(output, 'goal-settings-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('#goal-dialog').screenshot({ path: path.join(output, 'goal-settings-desktop.png') });
    assert.deepEqual(errors, []);
    const report = {
      checkedAt: new Date().toISOString(), views: 5, viewportWidths: [1440, 1024, 390],
      documentOverflow: 0, consoleErrors: errors,
      checks: ['search and empty state', 'status filters', 'student detail', 'individual goal update',
        'bulk goal update', 'actual records preserved', 'last session reaches target', 'monotonic schedule',
        'holidays excluded', 'date validation', 'calendar navigation', 'student selection',
        'keyboard tab navigation', 'mobile goal dialog'],
    };
    fs.writeFileSync(path.join(__dirname, 'qa-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally {
    await browser.close();
  }
}
verify().catch(error => { console.error(error); process.exitCode = 1; });
