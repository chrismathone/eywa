import { expect, test } from '@playwright/test';
import { sourceFixture } from '../../../src/features/timetable-lab/editor/source-fixture.test-support';

test.beforeEach(async ({ page }) => { await page.goto('/?sample=1'); });
test('uses the viewport and offers a native timetable with a collapsible inspector', async ({ page }) => {
  const region = page.getByRole('region', { name: '시간표 편집 영역' });
  const box = (await region.boundingBox())!;
  expect(box.width).toBeGreaterThan(1400); expect(box.height).toBeGreaterThan(840);
  await expect(page.getByRole('tab', { name: 'Univer', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /배치 확인/ }).click(); await expect(page.locator('.lab-inspector')).toBeVisible();
  await page.getByRole('button', { name: '확인 패널 닫기' }).click(); await expect(page.locator('.lab-inspector')).toHaveCount(0);
});
test('drags into a conflicting placement, changes day, and undo restores the original', async ({ page }) => {
  const block = page.locator('[data-block-id="placement-1"]'); const box = (await block.boundingBox())!;
  const lane = (await page.locator('[data-lane="강사 나"][data-day="월"]').boundingBox())!;
  await page.mouse.move(box.x + 30, box.y + 15); await page.mouse.down(); await page.mouse.move(lane.x + 30, box.y + 43, { steps: 8 }); await page.mouse.up();
  await expect(block).toHaveAttribute('aria-label', '영어 A 월 18:20 강사 나'); await expect(block).toHaveClass(/has-conflict/);
  await page.keyboard.press('Control+z'); await expect(block).toHaveAttribute('aria-label', '영어 A 월 18:00 강사 가');
  const original = (await block.boundingBox())!, tuesday = (await page.locator('[data-lane="강사 가"][data-day="화"]').boundingBox())!;
  await page.mouse.move(original.x + 30, original.y + 15); await page.mouse.down(); await page.mouse.move(tuesday.x + 30, original.y + 15, { steps: 10 }); await page.mouse.up();
  await expect(block).toHaveAttribute('aria-label', '영어 A 화 18:00 강사 가');
  await page.keyboard.press('Control+z'); await expect(block).toHaveAttribute('aria-label', '영어 A 월 18:00 강사 가');
});
test('native clipboard copy and cut preserve one undo step and stable move identity', async ({ page }) => {
  const block = page.locator('[data-block-id="placement-1"]'); await block.click(); await page.keyboard.press('Control+c');
  await page.locator('[data-lane="강사 나"][data-day="월"]').click({ position: { x: 30, y: 220 } }); await page.keyboard.press('Control+v');
  await expect(page.locator('.lesson-block')).toHaveCount(4);
  await page.keyboard.press('Control+z'); await expect(page.locator('.lesson-block')).toHaveCount(3);
  await block.click(); await page.keyboard.press('Control+x');
  await page.locator('[data-lane="강사 나"][data-day="월"]').click({ position: { x: 30, y: 220 } }); await page.keyboard.press('Control+v');
  await expect(page.locator('.lesson-block')).toHaveCount(3); await expect(block).toHaveAttribute('aria-label', /강사 나$/);
  await page.keyboard.press('Control+z'); await expect(block).toHaveAttribute('aria-label', '영어 A 월 18:00 강사 가');
});
test('loads a complete source preview, keeps weekends and unknown rooms, and undo restores the old draft', async ({ page }) => {
  await page.route('**/api/timetable/lab/source?*', route => route.fulfill({ json: sourceFixture() }));
  await page.getByRole('button', { name: '기존 시간표 불러오기' }).click();
  await page.getByRole('button', { name: '시간표 불러오기', exact: true }).click();
  await expect(page.getByText('검증 학원', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '이 시간표로 연습 시작' }).click();
  await expect(page.locator('[data-block-id="source:schedule-0"]')).toBeVisible();
  await expect(page.locator('[data-block-id="source:schedule-4"]')).toBeVisible();
  await page.getByRole('button', { name: '되돌리기', exact: true }).click();
  await expect(page.locator('[data-block-id="placement-1"]')).toBeVisible();
});
test('failed source load retains the draft and requires login without leaving the dialog', async ({ page }) => {
  await page.route('**/api/timetable/lab/source?*', route => route.fulfill({ status: 401, json: { error: '로그인이 필요합니다.' } }));
  await page.getByRole('button', { name: '기존 시간표 불러오기' }).click(); await page.getByRole('button', { name: '시간표 불러오기', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('로그인이 필요합니다.'); await expect(page.getByRole('link', { name: '로그인 창 열기' })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.locator('[data-block-id="placement-1"]')).toBeVisible();
});
test('teacher placements, integrated students, suggestions and undo use the same history', async ({ page }) => {
  await page.locator('[data-block-id="placement-1"]').dblclick(); await expect(page.locator('.lab-inspector')).toBeVisible();
  await page.getByRole('button', { name: '겹치지 않는 시간 찾기' }).click(); await page.getByRole('button', { name: '이 시간으로 옮겨 보기' }).first().click();
  await expect(page.locator('[data-block-id="placement-1"]')).toHaveAttribute('aria-label', '영어 A 월 17:00 강사 가');
  await page.getByRole('button', { name: '되돌리기', exact: true }).click();
  await page.getByRole('tab', { name: '통합뷰' }).click();
  await page.getByRole('form', { name: '학생 배정 이동' }).locator('[name="target"]').selectOption('placement-2');
  await page.getByRole('button', { name: '이 시간의 학생만 옮기기' }).click();
  await expect(page.locator('[data-class-id="class-1"]')).toContainText('배정 학생 없음');
  await expect(page.locator('[data-class-id="class-2"]')).toContainText('학생 가');
  await page.getByRole('button', { name: '되돌리기', exact: true }).click(); await expect(page.locator('[data-class-id="class-2"]')).not.toContainText('학생 가');
});
test('Escape cancels an active drag and a stale cut cannot erase the source', async ({ page }) => {
  const block = page.locator('[data-block-id="placement-1"]'), rect = (await block.boundingBox())!;
  await page.mouse.move(rect.x + 25, rect.y + 12); await page.mouse.down(); await page.mouse.move(rect.x + 30, rect.y + 60, { steps: 5 });
  await page.keyboard.press('Escape'); await page.mouse.up(); await expect(block).toHaveAttribute('aria-label', '영어 A 월 18:00 강사 가');
  await block.click(); await page.keyboard.press('Control+x');
  await page.evaluate(() => { const store = window.labProbe!; const next = structuredClone(store.getSnapshot().draft); next.cells[2][0].text = 'Changed'; store.commit('test edit', next); });
  await page.locator('[data-lane="강사 나"][data-day="월"]').click({ position: { x: 30, y: 220 } }); await page.keyboard.press('Control+v');
  await expect(page.getByRole('status')).toContainText('시간표가 변경되었습니다'); await expect(block).toHaveAttribute('aria-label', '영어 A 월 18:00 강사 가');
});
test('a new source import invalidates clipboard identities from the previous draft', async ({ page }) => {
  await page.locator('[data-block-id="placement-1"]').click(); await page.keyboard.press('Control+c');
  await page.route('**/api/timetable/lab/source?*', route => route.fulfill({ json: sourceFixture() }));
  await page.getByRole('button', { name: '기존 시간표 불러오기' }).click(); await page.getByRole('button', { name: '시간표 불러오기', exact: true }).click();
  await page.getByRole('button', { name: '이 시간표로 연습 시작' }).click();
  await page.locator('[data-lane="강사 나"][data-day="월"]').click({ position: { x: 30, y: 220 } }); await page.keyboard.press('Control+v');
  await expect(page.getByRole('status')).toContainText('복사할 수업을 다시 선택'); await expect(page.locator('.lesson-block')).toHaveCount(5);
});
