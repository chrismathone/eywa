import { expect, test, type Page } from '@playwright/test';
import type { Draft } from '../../../src/features/timetable-lab/editor/model';
import type { DraftSummary } from '../../../src/features/timetable-lab/editor/draft-api';
import { sourceFixture } from '../../../src/features/timetable-lab/editor/source-fixture.test-support';
const libraryButton = (page: Page) => page.getByRole('button', { name: '연습본 저장·불러오기·비교' });
test('saves multiple DB snapshots, survives reload, compares readonly and loads with one undo', async ({ page }) => {
  const saved: { item: DraftSummary; snapshot: Draft }[] = [], writes: string[] = [];
  page.on('request', request => { if (request.method() === 'POST') writes.push(request.url()); });
  await page.route('**/api/timetable/lab/drafts**', async route => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() === 'POST') {
      const input = request.postDataJSON(), item: DraftSummary = { id: `00000000-0000-4000-8000-${String(saved.length + 1).padStart(12, '0')}`, name: input.name,
        subject: 'english', createdAt: new Date().toISOString(), lessonCount: 3, classCount: 3, studentCount: 3, referenceDate: null };
      saved.push({ item, snapshot: input.snapshot }); return route.fulfill({ status: 201, json: { item } });
    }
    const id = url.pathname.split('/').at(-1), value = saved.find(s => s.item.id === id);
    return route.fulfill({ json: value ? { version: 1, ...value } : { items: saved.map(s => s.item).reverse(), nextOffset: null } });
  });
  await page.goto('/?sample=1'); await libraryButton(page).click(); const library = page.getByRole('dialog', { name: '연습본 저장·불러오기' });
  await library.getByLabel('연습본 이름').fill('A안'); await library.getByRole('button', { name: '새 연습본으로 저장' }).click();
  await expect(library.getByRole('status')).toContainText('저장했습니다'); await library.getByRole('button', { name: '닫기', exact: true }).click();
  await page.locator('[data-block-id="placement-1"]').dblclick(); await page.getByRole('form', { name: '반 이름 변경' }).getByLabel('반 이름').fill('변경한 영어 A');
  await page.getByRole('button', { name: '반 이름 바꾸기' }).click(); await expect(page.locator('.lab-status b')).toContainText('저장하지 않은 변경');
  await libraryButton(page).click(); await library.getByLabel('연습본 이름').fill('B안'); await library.getByRole('button', { name: '새 연습본으로 저장' }).click();
  await expect(library.getByRole('status')).toContainText('저장했습니다');
  await library.getByLabel('비교할 왼쪽 연습본').selectOption(saved[0].item.id); await library.getByLabel('비교할 오른쪽 연습본').selectOption(saved[1].item.id);
  await library.getByRole('button', { name: '나란히 비교하기' }).click(); const comparison = page.getByRole('dialog', { name: '연습본 비교' });
  await expect(comparison).toContainText('변경 1개'); await expect(comparison).toContainText('반 이름: 영어 A → 변경한 영어 A');
  const revision = await page.evaluate(() => window.labProbe!.getSnapshot().revision);
  await comparison.getByRole('region').first().focus(); await page.keyboard.press('Control+z'); await page.keyboard.press('Delete');
  expect(await page.evaluate(() => window.labProbe!.getSnapshot().revision)).toBe(revision);
  await page.screenshot({ path: '.artifacts/draft-comparison.png' }); await comparison.getByRole('button', { name: '비교 닫기' }).click();
  await libraryButton(page).click(); await library.getByRole('button', { name: '불러오기 A안', exact: true }).click();
  await expect(page.locator('[data-block-id="placement-1"]')).toContainText('영어 A');
  await page.getByRole('button', { name: '되돌리기', exact: true }).click(); await expect(page.locator('[data-block-id="placement-1"]')).toContainText('변경한 영어 A');
  page.on('dialog', dialog => dialog.accept()); await page.reload(); await libraryButton(page).click();
  await expect(library.locator('.draft-list li')).toHaveCount(2); await library.getByRole('button', { name: '불러오기 B안', exact: true }).click();
  await expect(page.locator('[data-block-id="placement-1"]')).toContainText('변경한 영어 A');
  expect(writes).toHaveLength(2); expect(writes.every(url => url.endsWith('/api/timetable/lab/drafts'))).toBe(true);
});
test('save failure and malformed loaded snapshot leave current work intact', async ({ page }) => {
  const id = '00000000-0000-4000-8000-000000000001';
  await page.route('**/api/timetable/lab/drafts**', route => {
    if (route.request().method() === 'POST') return route.fulfill({ status: 503, json: { error: '저장 실패. 다시 시도해 주세요.' } });
    if (route.request().url().endsWith(id)) return route.fulfill({ json: { version: 1, snapshot: { placements: [] } } });
    return route.fulfill({ json: { items: [{ id, name: '불완전한 자료', createdAt: new Date().toISOString(), lessonCount: 3, classCount: 3, studentCount: 3 }], nextOffset: null } });
  });
  await page.goto('/?sample=1'); await libraryButton(page).click(); const library = page.getByRole('dialog', { name: '연습본 저장·불러오기' });
  await library.getByRole('button', { name: '새 연습본으로 저장' }).click(); await expect(library.getByRole('alert')).toContainText('저장 실패');
  await library.getByRole('button', { name: '불러오기 불완전한 자료' }).click(); await expect(library.getByRole('alert')).toContainText('형식');
  expect(await page.evaluate(() => window.labProbe!.getSnapshot().revision)).toBe(0);
});
test('an imported operating snapshot and moved-student marks survive the shared snapshot schema and reload', async ({ page }) => {
  let stored: { version: 1; name: string; snapshot: Draft } | undefined;
  const id = '00000000-0000-4000-8000-000000000099', item = { id, name: '불러온 시간표 연습', subject: 'english', createdAt: new Date().toISOString(), lessonCount: 5, classCount: 5, studentCount: 2, referenceDate: '2026-09-28' };
  await page.route('**/api/timetable/lab/source?*', route => route.fulfill({ json: sourceFixture() }));
  await page.route('**/api/timetable/lab/drafts**', route => {
    if (route.request().method() === 'POST') {
      stored = route.request().postDataJSON(); return route.fulfill({ status: 201, json: { item } });
    }
    if (route.request().url().endsWith(id)) return route.fulfill({ json: { version: 1, item, snapshot: stored!.snapshot } });
    return route.fulfill({ json: { items: stored ? [item] : [], nextOffset: null } });
  });
  await page.goto('/'); await page.getByRole('button', { name: '기존 시간표 불러오기' }).first().click();
  await page.getByRole('button', { name: '시간표 불러오기', exact: true }).click(); await page.getByRole('button', { name: '이 시간표로 연습 시작' }).click();
  await page.locator('[data-block-id="source:schedule-0"]').dblclick(); await page.locator('.class-tools summary').click();
  const move = page.getByRole('form', { name: '다른 반으로 학생 이동' }); await move.locator('[name="target"]').selectOption('class-1'); await move.getByRole('button').click();
  await libraryButton(page).click(); const library = page.getByRole('dialog', { name: '연습본 저장·불러오기' });
  await library.getByRole('button', { name: '새 연습본으로 저장' }).click(); await expect(library.getByRole('status')).toContainText('저장했습니다');
  expect(stored!.snapshot.operatingHours?.['토']).toContainEqual({ start: 1080, end: 1140 });
  expect(stored!.snapshot.studentMoves?.['class-1']?.s1.fromClassId).toBe('class-0');
  await library.getByRole('button', { name: '불러오기 불러온 시간표 연습', exact: true }).click(); await page.getByRole('tab', { name: '통합뷰' }).click();
  await expect(page.locator('[data-class-id="class-1"] [data-student-id="s1"]')).toHaveCSS('background-color', 'rgb(187, 247, 208)');
});
test('Ctrl+S opens the library, but never stacks it on top of an open class dialog', async ({ page }) => {
  await page.route('**/api/timetable/lab/drafts**', route => route.fulfill({ json: { items: [], nextOffset: null } }));
  await page.goto('/?sample=1'); await page.getByRole('tab', { name: '통합뷰' }).click(); await page.locator('[data-class-id="class-1"] .class-name-row').click();
  await page.getByRole('button', { name: '다른 반과 합치기', exact: true }).click();
  const merge = page.getByRole('dialog', { name: '다른 반과 합치기' }), library = page.getByRole('dialog', { name: '연습본 저장·불러오기' });
  await expect(merge).toBeVisible(); await page.keyboard.press('Control+s');
  await expect(page.locator('.lab-status [role="status"]')).toContainText('먼저 닫은 뒤'); await expect(library).toHaveCount(0); await expect(merge).toBeVisible();
  await merge.getByRole('button', { name: '취소' }).click(); await page.keyboard.press('Control+s'); await expect(library).toBeVisible();
});
