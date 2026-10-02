import { expect, test, type Page } from '@playwright/test';
async function rosterMove(page: Page, student = 's1') {
  await page.getByRole('tab', { name: '통합뷰' }).click();
  const from = page.locator(`[data-class-id="class-1"] [data-student-id="${student}"]`), to = page.locator('[data-class-id="class-2"] .integrated-roster');
  const a = (await from.boundingBox())!, b = (await to.boundingBox())!;
  await page.mouse.move(a.x + 25, a.y + 13); await page.mouse.down();
  await page.mouse.move(b.x + 25, b.y + 13, { steps: 8 }); await page.mouse.up();
}
test.beforeEach(async ({ page }) => { await page.goto('/?sample=1'); await expect(page.locator('[data-block-id="placement-1"]')).toBeVisible(); });
test('renames the class in both views and rejects an old clipboard after roster/name changes', async ({ page }) => {
  const block = page.locator('[data-block-id="placement-1"]'); await block.click(); await page.keyboard.press('Control+c');
  await block.dblclick(); const form = page.getByRole('form', { name: '반 이름 변경' });
  await form.getByLabel('반 이름').fill('11월 영어 심화'); await form.getByRole('button', { name: '반 이름 바꾸기' }).click();
  await expect(block).toContainText('11월 영어 심화');
  await page.getByRole('button', { name: '확인 패널 닫기' }).click(); await block.click(); await page.keyboard.press('Control+v');
  await expect(page.getByRole('status')).toContainText('다시 복사'); await expect(page.locator('.lesson-block')).toHaveCount(3);
  await page.getByRole('tab', { name: '통합뷰' }).click(); await expect(page.locator('[data-class-id="class-1"] .class-name-row')).toContainText('11월 영어 심화');
  await page.getByRole('button', { name: '되돌리기', exact: true }).click(); await expect(page.locator('[data-class-id="class-1"] .class-name-row')).toContainText('영어 A');
});
test('drag assigns all destination lessons, marks the moved student in the operating mint color, and undoes once', async ({ page }) => {
  await page.evaluate(() => {
    const store = window.labProbe!, next = structuredClone(store.getSnapshot().draft);
    const row = next.cells.length; next.cells.push(next.cells[2].map(c => ({ ...c }))); next.cells[row][1].text = '금';
    next.placements.push({ ...next.placements[1], id: 'second-day', row }); store.commit('test second day', next);
  });
  await rosterMove(page);
  const moved = page.locator('[data-class-id="class-2"] [data-student-id="s1"]');
  await expect(moved).toHaveCSS('background-color', 'rgb(187, 247, 208)'); await expect(moved).toHaveAttribute('title', /영어 A에서 옮김/);
  expect(await page.evaluate(() => window.labProbe!.getSnapshot().draft.placements.filter(p => p.classId === 'class-2').every(p => p.studentIds?.includes('s1')))).toBe(true);
  await expect(page.locator('[data-class-id="class-1"] [data-student-id="s1"]')).toHaveCount(0);
  await page.screenshot({ path: '.artifacts/student-move-mark.png' });
  await page.getByRole('button', { name: '되돌리기', exact: true }).click(); await expect(moved).toHaveCount(0);
  await expect(page.locator('[data-class-id="class-1"] [data-student-id="s1"]')).toBeVisible();
});
test('Escape and a changed revision cancel a student drag without losing assignments', async ({ page }) => {
  await page.getByRole('tab', { name: '통합뷰' }).click();
  const from = page.locator('[data-class-id="class-1"] [data-student-id="s1"]'), to = page.locator('[data-class-id="class-2"] .integrated-roster');
  const a = (await from.boundingBox())!, b = (await to.boundingBox())!;
  for (const cancellation of ['escape', 'revision']) {
    await page.mouse.move(a.x + 30, a.y + 10); await page.mouse.down(); await page.mouse.move(b.x + 30, b.y + 10, { steps: 5 });
    if (cancellation === 'escape') await page.keyboard.press('Escape');
    else await page.evaluate(() => { const store = window.labProbe!, next = structuredClone(store.getSnapshot().draft); next.cells[3][0].text = '변경'; store.commit('during drag', next); });
    await page.mouse.up(); await expect(from).toBeVisible(); await expect(page.locator('[data-class-id="class-2"] [data-student-id="s1"]')).toHaveCount(0);
  }
});
test('merging previews the retained timetable; splitting previews students and copies a visible class, both undo atomically', async ({ page }) => {
  await page.getByRole('tab', { name: '통합뷰' }).click(); await page.locator('[data-class-id="class-1"] .class-name-row').click();
  await page.getByRole('button', { name: '다른 반과 합치기', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '다른 반과 합치기' }); await dialog.getByLabel('합친 뒤 남길 반').selectOption('class-2');
  await expect(dialog).toContainText('학생 2명을 영어 B의 모든 수업에 배정'); await dialog.getByRole('button', { name: '이 내용으로 반 합치기' }).click();
  await expect(page.locator('[data-class-id="class-1"]')).toHaveCount(0);
  await page.locator('[data-class-id="class-2"] .class-name-row').click(); await page.getByRole('button', { name: '두 반으로 나누기', exact: true }).click();
  const split = page.getByRole('dialog', { name: '두 반으로 나누기' }); await split.getByLabel('새 반 이름').fill('영어 새 반'); await split.getByLabel('학생 가', { exact: true }).check();
  await expect(split).toContainText('처음에는 강사·강의실이 겹치므로'); await split.getByRole('button', { name: '이 내용으로 반 나누기' }).click();
  const created = page.locator('.integrated-class').filter({ has: page.locator('.class-name-row', { hasText: '영어 새 반' }) });
  await expect(created.locator('[data-student-id="s1"]')).toHaveClass(/student-moved/); await expect(created).toContainText('!');
  await page.getByRole('button', { name: '되돌리기', exact: true }).click(); await expect(created).toHaveCount(0);
  await page.getByRole('button', { name: '되돌리기', exact: true }).click(); await expect(page.locator('[data-class-id="class-1"]')).toBeVisible();
});
test('changes duration freely inside operating hours and blocks out of hours without mutating the schedule', async ({ page }) => {
  const block = page.locator('[data-block-id="placement-1"]'); await block.dblclick(); const form = page.getByRole('form', { name: '수업 시간 변경' });
  await form.getByRole('button', { name: '40분', exact: true }).click(); await form.getByRole('button', { name: '수업 시간·강사 바꾸기' }).click();
  await expect(block).toHaveAttribute('title', /18:00–18:40/);
  await form.getByRole('button', { name: '60분', exact: true }).click(); await form.getByRole('button', { name: '수업 시간·강사 바꾸기' }).click();
  await expect(block).toHaveAttribute('title', /18:00–19:00/);
  await form.getByLabel('수업 종료').fill('23:00'); await expect(form.getByRole('button', { name: '수업 시간·강사 바꾸기' })).toBeDisabled();
  await expect(block).toHaveAttribute('title', /18:00–19:00/); await expect(form.getByRole('alert')).toContainText('운영시간');
  await form.getByLabel('수업 종료').fill('19:00'); await page.screenshot({ path: '.artifacts/class-editing-panel.png' });
});
test('a meeting outside lesson hours can be retimed from the form like dragging it, while a lesson there stays blocked', async ({ page }) => {
  await page.evaluate(() => {
    const store = window.labProbe!, next = structuredClone(store.getSnapshot().draft), row = next.cells.length;
    next.cells.push(['강사 회의', '월', '09:00', '10:00', '강사 가', ''].map(text => ({ text })));
    next.placements.push({ id: 'meeting', sourceScheduleId: null, classId: '', kind: 'block', row }); store.commit('test meeting', next);
  });
  const meeting = page.locator('[data-block-id="meeting"]'); await meeting.dblclick();
  const form = page.getByRole('form', { name: '수업 시간 변경' }), submit = form.getByRole('button', { name: '수업 시간·강사 바꾸기' });
  await expect(submit).toBeEnabled(); await expect(form.getByRole('alert')).toHaveCount(0); await expect(form).toContainText('수업 운영시간 밖에도');
  await form.getByLabel('수업 종료').fill('10:30'); await submit.click(); await expect(meeting).toHaveAttribute('title', /09:00–10:30/);
  await form.getByLabel('수업 종료').fill('08:00'); await expect(submit).toBeDisabled(); await expect(form.getByRole('alert')).toContainText('시작보다 늦은');
  await page.getByRole('button', { name: '확인 패널 닫기' }).click(); await page.locator('[data-block-id="placement-1"]').dblclick();
  await form.getByLabel('수업 시작').fill('09:00'); await form.getByLabel('수업 종료').fill('10:00');
  await expect(submit).toBeDisabled(); await expect(form.getByRole('alert')).toContainText('운영시간');
});
