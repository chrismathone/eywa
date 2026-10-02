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
test.beforeEach(async ({ page }) => { await page.goto('/?compare=1'); await expect(page.getByRole('heading', { name: '영어 시간표 연습실' })).toBeVisible(); });

test('DOM: teacher edit -> projection -> student assignment -> shared Undo/Redo', async ({ page }) => {
  const initial = await snapshot(page);
  await cell(page, 1, 1).dblclick();
  await page.getByRole('textbox').fill('화'); await page.keyboard.press('Enter');
  await expect(page.locator('[data-placement-id="placement-1"]')).toContainText('화 18:00');
  await page.getByRole('button', { name: '학생 배정', exact: true }).click();
  await expect(page.locator('[data-placement-id="placement-2"]')).toContainText('학생 가');
  await page.getByRole('button', { name: /^되돌리기/ }).click();
  await expect(page.locator('[data-placement-id="placement-1"]')).toContainText('학생 가');
  await cell(page, 1, 1).click(); await page.keyboard.press('Control+z');
  expect((await snapshot(page)).draft).toEqual(initial.draft);
  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('[data-placement-id="placement-1"]')).toContainText('화 18:00');
});
test('DOM: trusted 2x3 copy/paste, one undo and cut failure leaves source intact', async ({ page }) => {
  await cell(page, 1, 0).click();
  await page.keyboard.press('Shift+ArrowRight'); await page.keyboard.press('Shift+ArrowRight'); await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Control+c');
  const text = await page.evaluate(() => navigator.clipboard.readText()); expect(text).toContain('영어 A\t월\t18:00');
  await cell(page, 5, 0).click(); await page.keyboard.press('Control+v');
  await expect(cell(page, 5, 0)).toHaveText('영어 A'); await expect(cell(page, 6, 2)).toHaveText('18:00');
  await page.keyboard.press('Control+z'); await expect(cell(page, 5, 0)).toBeEmpty();
  await cell(page, 1, 0).click(); await page.keyboard.press('Shift+ArrowRight'); await page.keyboard.press('Control+x');
  await cell(page, 9, 5).click(); await page.keyboard.press('Control+v');
  await expect(cell(page, 1, 0)).toHaveText('영어 A'); await expect(page.getByRole('status')).toContainText('공간이 부족');
});
test('DOM: multiline external TSV, untrusted HTML inert, clipboard failure is atomic', async ({ page }) => {
  await page.evaluate(() => navigator.clipboard.writeText('"첫 줄\n둘째 줄"\t<img src=x onerror=alert(1)>'));
  await cell(page, 6, 0).click(); await page.keyboard.press('Control+v');
  await expect(cell(page, 6, 0)).toHaveText('첫 줄\n둘째 줄');
  expect(await page.locator('.dom-grid img').count()).toBe(0);
  await page.evaluate(() => navigator.clipboard.writeText('"not closed'));
  await cell(page, 6, 0).click(); await page.keyboard.press('Control+v');
  await expect(cell(page, 6, 0)).toHaveText('첫 줄\n둘째 줄');
});
test('DOM: IME composition signal protects Enter; text-buffer Ctrl+A/C/V stays in editor', async ({ page, context }) => {
  await cell(page, 5, 0).dblclick(); const input = page.getByRole('textbox');
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.imeSetComposition', { text: '한글', selectionStart: 2, selectionEnd: 2 });
  await page.keyboard.press('Enter');
  expect((await snapshot(page)).undos).toBe(0);
  await cdp.send('Input.insertText', { text: '한글' });
  await input.fill('한글 입력'); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+c');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('한글 입력');
  await page.keyboard.press('Enter'); await expect(cell(page, 5, 0)).toHaveText('한글 입력');
});
test('Univer API: own workbook history remains empty across format / placement / student undo', async ({ page }) => {
  await univer(page);
  await page.evaluate(() => window.univerProbe!.bold('A2'));
  await page.evaluate(() => window.univerProbe!.value('B2', '화'));
  await expect(page.locator('[data-placement-id="placement-1"]')).toContainText('화 18:00');
  await page.getByRole('button', { name: '학생 배정', exact: true }).click();
  expect((await snapshot(page)).undos).toBe(3);
  await page.getByRole('button', { name: /^되돌리기/ }).click();
  await page.getByRole('button', { name: /^되돌리기/ }).click();
  expect((await snapshot(page)).draft.cells[1][1].text).toBe('월');
  expect((await snapshot(page)).draft.cells[1][0].bold).toBe(true);
  await address(page, 'A2'); await page.keyboard.press('Control+z');
  await expect.poll(async () => (await snapshot(page)).undos).toBe(0);
  expect(await page.evaluate(() => window.univerProbe!.nativeHistory())).toBe(0);
});
test('Univer: trusted grid copy/paste and Ctrl+Z use the common state', async ({ page }) => {
  await univer(page); await address(page, 'A2:C3'); await page.keyboard.press('Control+c');
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('영어 A');
  await address(page, 'A6'); await page.keyboard.press('Control+v');
  await expect.poll(async () => (await snapshot(page)).draft.cells[5][0].text).toBe('영어 A');
  expect((await snapshot(page)).undos).toBe(1);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await snapshot(page)).draft.cells[5][0].text).toBe('');
  expect(await page.evaluate(() => window.univerProbe!.nativeHistory())).toBe(0);
});
test('suggestions solve current roster conflict, keep IDs, expire after an edit, and undo as one command', async ({ page }) => {
  const initial = await snapshot(page);
  await expect(page.getByTestId('issues')).toContainText('수학 샘플');
  await page.getByRole('button', { name: '영어 A의 가능한 시간 찾기' }).click();
  await page.getByRole('button', { name: '이 시간으로 연습' }).first().click();
  await expect(page.getByTestId('issues')).toBeEmpty();
  expect((await snapshot(page)).draft.placements).toEqual(initial.draft.placements);
  await page.getByRole('button', { name: /^되돌리기/ }).click();
  expect((await snapshot(page)).draft).toEqual(initial.draft);
  await page.getByRole('button', { name: '영어 A의 가능한 시간 찾기' }).click();
  await page.getByRole('button', { name: '학생 배정', exact: true }).click();
  await expect(page.getByRole('button', { name: '시간표 변경됨 · 다시 검색' }).first()).toBeDisabled();
});
test('formula and HTML payload cause no external network requests or semantic changes', async ({ page }) => {
  const requests: string[] = []; page.on('request', r => { if (!r.url().startsWith('http://127.0.0.1:4317')) requests.push(r.url()); });
  await univer(page); const before = (await snapshot(page)).draft.cells[1][2].text;
  await page.evaluate(() => window.univerProbe!.value('C2', '=IMPORTXML("https://example.com", "//body")'));
  expect((await snapshot(page)).draft.cells[1][2].text).toBe(before);
  await expect(page.locator('[data-placement-id="placement-1"]')).toContainText('월 18:00');
  expect(requests).toEqual([]);
});
test('Univer: trusted cell editing changes the projection and retains one workbook undo', async ({ page }) => {
  await univer(page); await address(page, 'B2'); await page.keyboard.press('F2');
  await page.keyboard.press('Control+a'); await page.keyboard.insertText('화'); await page.keyboard.press('Enter');
  await expect(page.locator('[data-placement-id="placement-1"]')).toContainText('화 18:00');
  expect((await snapshot(page)).undos).toBe(1);
  await page.keyboard.press('Control+z');
  await expect(page.locator('[data-placement-id="placement-1"]')).toContainText('월 18:00');
  expect(await page.evaluate(() => window.univerProbe!.nativeHistory())).toBe(0);
});
