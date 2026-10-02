import { expect, test } from '@playwright/test';
import { sourceFixture } from '../../../src/features/timetable-lab/editor/source-fixture.test-support';

test('source colors reach both views and local color changes undo without network writes', async ({ page }) => {
  const writes: string[] = [];
  page.on('request', request => { if (!['GET', 'HEAD'].includes(request.method())) writes.push(request.url()); });
  await page.route('**/api/timetable/lab/source?*', route => route.fulfill({ json: sourceFixture() }));
  await page.goto('/?sample=1'); await page.getByRole('button', { name: '기존 시간표 불러오기' }).click();
  await page.getByRole('button', { name: '시간표 불러오기', exact: true }).click(); await page.getByRole('button', { name: '이 시간표로 연습 시작' }).click();
  const block = page.locator('[data-block-id="source:schedule-0"]');
  await expect(block).toHaveCSS('background-color', 'rgb(21, 101, 66)'); await expect(block).toHaveCSS('color', 'rgb(255, 255, 255)');
  await expect(block).toHaveClass(/has-conflict/);
  await expect(page.locator('.week-teacher-heading').first()).toContainText('Jane');
  await expect(page.locator('[data-lane="강사 가"]')).toHaveCount(7);
  await page.screenshot({ path: '.artifacts/teacher-week-view.png' });
  await block.dblclick(); await page.locator('.practice-colors summary').click();
  const form = page.getByRole('form', { name: '강사 색상' });
  await form.locator('[name="bg"]').fill('#123456'); await form.getByRole('button', { name: '색상 적용' }).click();
  await expect(block).toHaveCSS('background-color', 'rgb(18, 52, 86)');
  await page.getByRole('tab', { name: '통합뷰' }).click();
  await expect(page.locator('[data-integrated-id="source:schedule-0"]')).toHaveCSS('background-color', 'rgb(18, 52, 86)');
  await expect(page.locator('[data-class-id="class-0"] .class-name-row')).toHaveCSS('background-color', 'rgb(217, 234, 211)');
  await expect(page.locator('[data-class-id="class-0"] .integrated-roster')).toContainText('학생 가');
  expect((await page.locator('[data-class-id="class-3"]').boundingBox())!.width).toBe(165);
  await page.getByRole('button', { name: '되돌리기', exact: true }).click();
  await expect(page.locator('[data-integrated-id="source:schedule-0"]')).toHaveCSS('background-color', 'rgb(21, 101, 66)');
  await page.getByRole('button', { name: '확인 패널 닫기' }).click();
  await page.screenshot({ path: '.artifacts/integrated-class-view.png' });
  expect(writes).toEqual([]);
});

test('dragging across teacher weekdays updates the matching class card and undo restores it', async ({ page }) => {
  await page.goto('/?sample=1');
  const block = page.locator('[data-block-id="placement-1"]'), box = (await block.boundingBox())!;
  const target = (await page.locator('[data-lane="강사 나"][data-day="수"]').boundingBox())!;
  await page.mouse.move(box.x + 25, box.y + 20); await page.mouse.down();
  await page.mouse.move(target.x + 25, box.y + 20, { steps: 10 }); await page.mouse.up();
  await expect(block).toHaveAttribute('aria-label', '영어 A 수 18:00 강사 나');
  await page.getByRole('tab', { name: '통합뷰' }).click();
  await expect(page.locator('[data-integrated-id="placement-1"]')).toHaveAttribute('aria-label', '영어 A 수 18:00 강사 나');
  await page.getByRole('button', { name: '되돌리기', exact: true }).click();
  await expect(page.locator('[data-integrated-id="placement-1"]')).toHaveAttribute('aria-label', '영어 A 월 18:00 강사 가');
});

test('a copied overlap remains selectable in the integrated card instead of being overwritten', async ({ page }) => {
  await page.goto('/?sample=1'); await page.locator('[data-block-id="placement-1"]').click();
  await page.keyboard.press('Control+c'); await page.keyboard.press('Control+v');
  await expect(page.locator('.lesson-block')).toHaveCount(4);
  await page.getByRole('tab', { name: '통합뷰' }).click();
  await expect(page.locator('[data-class-id="class-1"] [data-integrated-id]')).toHaveCount(2);
  await page.locator('[data-class-id="class-1"] [data-integrated-id]').last().click();
  await expect(page.locator('.lab-inspector h2')).toHaveText('영어 A');
});

test('an afternoon block sharing the shifted morning axis keeps its real clock while dragging', async ({ page }) => {
  const source = sourceFixture(); source.slots[0].start = '10:00'; source.slots[0].end = '11:00';
  source.slots.push({ ...source.slots[0], id: 'afternoon', start: '14:20', end: '15:20', classId: 'afternoon-class' });
  await page.route('**/api/timetable/lab/source?*', route => route.fulfill({ json: source }));
  await page.goto('/'); await page.getByRole('button', { name: '기존 시간표 불러오기' }).first().click();
  await page.getByRole('button', { name: '시간표 불러오기', exact: true }).click(); await page.getByRole('button', { name: '이 시간표로 연습 시작' }).click();
  const block = page.locator('[data-block-id="source:afternoon"]'), rect = (await block.boundingBox())!;
  await page.mouse.move(rect.x + 25, rect.y + 15); await page.mouse.down(); await page.mouse.move(rect.x + 25, rect.y + 43, { steps: 8 }); await page.mouse.up();
  await expect(block).toHaveAttribute('aria-label', '영어 1 월 14:40 강사 가');
  await page.keyboard.press('Control+z'); await expect(block).toHaveAttribute('aria-label', '영어 1 월 14:20 강사 가');
});
