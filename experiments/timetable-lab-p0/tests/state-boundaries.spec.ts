import { test, expect, type Page } from '@playwright/test';
const snapshot = (page: Page) => page.evaluate(() => window.labProbe!.getSnapshot());
const cell = (page: Page, row: number, col: number) => page.locator(`[data-row="${row}"][data-col="${col}"]`);
async function univer(page: Page) {
  await page.getByRole('tab', { name: 'Univer', exact: true }).click();
  await page.waitForFunction(() => !!window.univerProbe);
}
async function address(page: Page, range: string) {
  const box = page.locator('.univer-host [data-u-comp="defined-name"] input');
  // The name box mounts slightly after univerProbe under load; an early Enter is ignored and the box stays on A1.
  await expect(async () => { await box.fill(range); await box.press('Enter'); await expect(box).toHaveValue(range, { timeout: 1200 }); }).toPass({ timeout: 15_000 });
}
// labProbe is assigned by a lazily loaded module, i.e. after the load event that goto() waits for.
test.beforeEach(async ({ page }) => { await page.goto('/?compare=1'); await page.waitForFunction(() => !!window.labProbe); });

test('DOM values-only paste retains destination formatting and Undo restores the value', async ({ page }) => {
  await cell(page, 5, 0).click(); await page.keyboard.press('Control+b');
  await cell(page, 1, 0).click(); await page.keyboard.press('Control+c');
  await cell(page, 5, 0).click(); await page.keyboard.press('Control+Shift+v');
  await expect(cell(page, 5, 0)).toHaveText('영어 A');
  expect((await snapshot(page)).draft.cells[5][0].bold).toBe(true);
  await page.keyboard.press('Control+z'); await expect(cell(page, 5, 0)).toBeEmpty();
  expect((await snapshot(page)).draft.cells[5][0].bold).toBe(true);
});

test('DOM delete cannot resurrect rich text on engine remount; style and common history survive', async ({ page }) => {
  await page.evaluate(() => {
    const draft = structuredClone(window.labProbe!.getSnapshot().draft);
    draft.cells[5][0] = { text: '메모', bold: true, format: { bg: { rgb: '#ff0000' } }, richText: { body: { dataStream: '메모\r\n' } } };
    window.labProbe!.commit('test rich text fixture', draft);
  });
  await cell(page, 5, 0).click(); await page.keyboard.press('Delete');
  const deleted = await snapshot(page); expect(deleted.draft.cells[5][0].richText).toBeUndefined();
  await univer(page);
  expect(await page.evaluate(() => window.univerProbe!.cell('A6'))).toMatchObject({ v: '', p: null, s: { bg: { rgb: '#ff0000' }, bl: 1 } });
  expect(await snapshot(page)).toEqual(deleted);
  await page.getByRole('tab', { name: '자체 격자', exact: true }).click();
  await cell(page, 5, 0).click(); await page.keyboard.press('Control+z');
  await expect(cell(page, 5, 0)).toHaveText('메모');
  await univer(page);
  expect(await page.evaluate(() => window.univerProbe!.nativeHistory())).toBe(0);
  expect((await snapshot(page)).undos).toBe(1);
});

test('Univer cut beyond the fixed experiment boundary cannot erase its source', async ({ page }) => {
  await univer(page); const before = (await snapshot(page)).draft;
  await address(page, 'A2:B2'); await page.keyboard.press('Control+x');
  await address(page, 'F10'); await page.keyboard.press('Control+v');
  await expect.poll(async () => (await snapshot(page)).draft.cells[1][0].text).toBe('영어 A');
  // Let the asynchronous paste settle before asserting the full document, not just the source.
  await expect(page.getByRole('status')).toContainText('범위');
  expect((await snapshot(page)).draft).toEqual(before);
});

test('prototype styles leave the native toolbar and formula editor usable', async ({ page }) => {
  await univer(page);
  await expect(page.locator('.univer-host [data-u-comp="formula-bar"]')).toBeVisible();
  const widths = await page.evaluate(() => {
    const host = document.querySelector('.univer-host')!, bar = host.querySelector('[data-u-comp="formula-bar"]')!;
    return { host: host.clientWidth, bar: bar.getBoundingClientRect().width };
  });
  expect(widths.bar).toBeGreaterThan(widths.host * 0.9);
  await expect(page.locator('.univer-host input').filter({ visible: true })).not.toHaveCount(0);
});
