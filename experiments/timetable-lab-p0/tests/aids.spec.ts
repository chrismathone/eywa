import { expect, test, type Page } from '@playwright/test';

// 예제: 영어 A(월 18~19, 강사 가, 201, 학생 가) · 영어 B(화 18~19, 강사 나, 202, 학생 나) · 영어 C(목 19~20, 강사 가, 201, 학생 다)
// 다른 과목: 수학 샘플(월 18~19, 수학 강사, 301, 학생 가) — 영어 A와 학생이 겹친다.
const block = (page: Page, id: string) => page.locator(`[data-block-id="${id}"]`);
const status = (page: Page) => page.locator('.lab-status [role=status]');
const heads = (page: Page) => page.locator('.week-teacher-heading');
const lanes = (page: Page, teacher: string) => page.locator(`[data-lane="${teacher}"]`);
const draftOf = (page: Page) => page.evaluate(() => window.labProbe!.getSnapshot().draft);
const undoButton = (page: Page) => page.getByRole('button', { name: '되돌리기', exact: true });
/** 강사 머리를 잡아 다른 머리의 왼쪽 끝(또는 제 자리)으로 끈다. 놓지는 않는다. */
async function dragHead(page: Page, from: number, to: number) {
  const a = (await heads(page).nth(from).boundingBox())!, b = (await heads(page).nth(to).boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
  await page.mouse.move(b.x + 8, b.y + b.height / 2, { steps: 8 });
}

test.beforeEach(async ({ page }) => { await page.goto('/?sample=1'); await expect(block(page, 'placement-1')).toBeVisible(); });

test('dragging a teacher heading moves the whole column; a plain click still opens the column menu', async ({ page }) => {
  await dragHead(page, 1, 0);
  await expect(page.locator('.column-drop-line')).toBeVisible(); await expect(page.locator('.roster-drag-ghost')).toContainText('강사 나 열 옮기기');
  await expect(page.locator('[data-lane="강사 나"][data-column-drag]')).not.toHaveCount(0); await expect(page.locator('[data-lane="강사 가"][data-column-drag]')).toHaveCount(0);
  await page.mouse.up();
  await expect(heads(page)).toHaveText(['강사 나', '강사 가']); expect((await draftOf(page)).teachers).toEqual(['강사 나', '강사 가']);
  await expect(status(page)).toContainText('강사 나 열을 옮겼습니다'); await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.locator('.column-drop-line')).toBeHidden(); await expect(page.locator('[data-column-drag]')).toHaveCount(0);
  // 수업은 강사를 따라간다 — 열만 자리를 바꿨다.
  await expect(block(page, 'placement-2')).toHaveAttribute('aria-label', /강사 나$/);
  await undoButton(page).click(); await expect(heads(page)).toHaveText(['강사 가', '강사 나']); await expect(undoButton(page)).toBeDisabled();
  // 제자리에 놓으면 아무것도 바뀌지 않고 기록도 늘지 않는다.
  await dragHead(page, 0, 0); await page.mouse.up();
  await expect(heads(page)).toHaveText(['강사 가', '강사 나']); await expect(undoButton(page)).toBeDisabled(); await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(status(page)).toContainText('강사 가 열을 옮기지 않았습니다');
  // 끌다가 Esc로 그만둔다.
  await dragHead(page, 1, 0); await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(heads(page)).toHaveText(['강사 가', '강사 나']); await expect(page.locator('.column-drop-line')).toBeHidden();
  await expect(status(page)).toContainText('강사 나 열을 옮기지 않았습니다');
  await page.getByRole('button', { name: '강사 가', exact: true }).click(); await expect(page.getByRole('menuitem', { name: '오른쪽으로 옮기기' })).toBeVisible();
});

test('a heading grabbed at the edge does not scroll by itself, and an undo in mid-drag clears the drag', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 800 });
  await page.evaluate(() => { const store = window.labProbe!, next = structuredClone(store.getSnapshot().draft); next.teachers = ['강사 가', '강사 나', '강사 다', '강사 라']; store.commit('test columns', next); });
  const scroller = page.locator('.schedule-scroll'), left = () => scroller.evaluate(el => el.scrollLeft);
  await scroller.evaluate(el => { el.scrollLeft = 500; });
  // 시간 열 바로 오른쪽(왼쪽 가장자리 구역 안)의 머리를 잡고 조금만 움직인 채 기다린다 — 화면이 혼자 밀리면 안 된다.
  const y = (await heads(page).first().boundingBox())!.y + 12;
  await page.mouse.move(75, y); await page.mouse.down(); await page.mouse.move(82, y + 3, { steps: 3 }); await page.waitForTimeout(400);
  expect(await left()).toBe(500); await page.mouse.up();
  await expect(heads(page)).toHaveText(['강사 가', '강사 나', '강사 다', '강사 라']); await expect(status(page)).toContainText('옮기지 않았습니다');
  expect(await page.evaluate(() => window.labProbe!.getSnapshot().undos)).toBe(1);
  // 가장자리 쪽으로 더 끌면 그때 민다.
  await page.mouse.move(75, y); await page.mouse.down(); await page.mouse.move(40, y, { steps: 5 }); await page.waitForTimeout(300);
  expect(await left()).toBeLessThan(500); await page.keyboard.press('Escape'); await page.mouse.up();
  // 끄는 동안 되돌리기로 그 열이 사라지면 이름표·세로선·흐림이 남지 않는다.
  await scroller.evaluate(el => { el.scrollLeft = el.scrollWidth; });
  const last = (await heads(page).last().boundingBox())!, first = (await heads(page).nth(2).boundingBox())!;
  await page.mouse.move(last.x + 30, last.y + 12); await page.mouse.down(); await page.mouse.move(first.x + 20, first.y + 12, { steps: 6 });
  await expect(page.locator('.roster-drag-ghost')).toContainText('강사 라 열 옮기기');
  await page.keyboard.press('Control+z'); await expect(heads(page)).toHaveText(['강사 가', '강사 나']);
  await expect(page.locator('.roster-drag-ghost')).toBeHidden(); await expect(page.locator('.column-drop-line')).toBeHidden(); await expect(page.locator('[data-column-drag]')).toHaveCount(0);
  await expect(status(page)).toContainText('끄는 동안 시간표가 바뀌어'); await page.mouse.up(); await expect(heads(page)).toHaveText(['강사 가', '강사 나']);
});

test('the time axis labels the closing time and a line closes the grid', async ({ page }) => {
  const last = page.locator('.time-axis span').last(), lane = page.locator('.schedule-lane').first();
  const label = (await last.boundingBox())!, box = (await lane.boundingBox())!;
  expect(Math.abs(label.y - (box.y + box.height))).toBeLessThan(3);
  await expect(lane).toHaveCSS('border-bottom-width', '1px');
  // 끝 눈금은 마지막 칸이 끝나는 시각이다.
  const texts = await page.locator('.time-axis span').allTextContents(), minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  expect(minutes(texts.at(-1)!) - minutes(texts[0])).toBe(Math.round(box.height / ((await block(page, 'placement-1').boundingBox())!.height / 6)) * 10);
  expect(new Set(texts).size).toBe(texts.length);
});

test('weekend columns: hide Saturday, show Sunday — a day with a lesson never hides', async ({ page }) => {
  await expect(lanes(page, '강사 가')).toHaveCount(6);
  await page.getByRole('button', { name: '토요일 숨기기' }).click(); await expect(lanes(page, '강사 가')).toHaveCount(5);
  await expect(status(page)).toContainText('토요일 칸을 숨겼습니다. 수업이 있는 토요일 칸은 그대로 보입니다.');
  await page.getByRole('button', { name: '일요일 보이기' }).click(); await expect(page.locator('[data-lane="강사 가"][data-day="일"]')).toHaveCount(1);
  expect((await draftOf(page)).appearance).toMatchObject({ hideSaturday: true, showSunday: true });
  await page.evaluate(() => { const store = window.labProbe!, next = structuredClone(store.getSnapshot().draft); next.cells[1][1].text = '토'; store.commit('test saturday', next); });
  await expect(page.locator('[data-lane="강사 가"][data-day="토"]')).toHaveCount(1); await expect(page.locator('[data-lane="강사 나"][data-day="토"]')).toHaveCount(0);
  await page.getByRole('button', { name: '일요일 숨기기' }).click(); await expect(page.locator('[data-day="일"]')).toHaveCount(0);
  await page.getByRole('button', { name: '빈 요일 접기' }).click();
  await expect(page.getByRole('button', { name: '토요일 보이기' })).toBeDisabled(); await expect(lanes(page, '강사 가')).toHaveCount(2);
  await page.getByRole('tab', { name: '통합뷰' }).click(); await expect(page.getByRole('button', { name: /토요일|일요일/ })).toHaveCount(0);
});

test('hovering a clashing lesson explains what it clashes with, in both views', async ({ page }) => {
  await expect(block(page, 'placement-1')).toHaveAttribute('title', /영어 A · 월 18:00–19:00 [^]*겹침: 수학 샘플\(수학 강사 · 301\) · 월 18:00~19:00 · 학생 겹침 \(학생 가\)/);
  await expect(block(page, 'placement-2')).not.toHaveAttribute('title', /겹침/);
  await page.getByRole('tab', { name: '통합뷰' }).click();
  await expect(page.locator('[data-integrated-id="placement-1"]')).toHaveAttribute('title', /겹침: 수학 샘플\(수학 강사 · 301\)/);
  await expect(page.locator('[data-integrated-id="placement-2"]')).not.toHaveAttribute('title', /겹침/);
});

test('class roster: students are columns and lessons are rows inside their own scroll box; search adds a student', async ({ page }) => {
  await block(page, 'placement-1').dblclick(); const roster = page.getByRole('region', { name: '반 학생 편집' });
  // 수업이 하나뿐인 반은 이름만 세로로 늘어놓는다.
  await expect(roster.locator('.roster-list li')).toHaveCount(1); await expect(roster.locator('table')).toHaveCount(0);
  await page.evaluate(() => {
    const store = window.labProbe!, next = structuredClone(store.getSnapshot().draft), row = next.cells.length;
    next.cells.push(next.cells[1].map(c => ({ ...c }))); next.cells[row][1].text = '수';
    next.placements.push({ ...next.placements[0], id: 'a-wed', row }); store.commit('test second day', next);
  });
  await expect(roster.getByRole('columnheader')).toHaveText(['수업', '학생 가']);
  await expect(roster.getByRole('rowheader')).toHaveText([/월\s*18:00/, /수\s*18:00/, '반에서']);
  const search = roster.getByLabel('넣을 학생 찾기'), found = roster.getByRole('list', { name: '찾은 학생' });
  await expect(found).toHaveCount(0);
  await search.fill('학생'); await expect(found.getByRole('button')).toHaveText([/학생 나.*영어 B/, /학생 다.*영어 C/]);
  await search.press('Enter'); await expect(status(page)).toContainText('2명이 있습니다'); await expect(roster.getByRole('columnheader')).toHaveCount(2);
  await search.fill('없는 이름'); await expect(found).toContainText('찾는 이름이 없습니다');
  // 쳤다 지운 빈 칸의 Ctrl+Z는 연습본을 건드리지 않는다(방금 넣은 직후에만 넘긴다).
  await search.fill(''); await search.press('Control+z'); expect(await page.evaluate(() => window.labProbe!.getSnapshot().undos)).toBe(1);
  await search.fill('다'); await search.press('Enter');
  await expect(roster.getByRole('columnheader')).toHaveText(['수업', '학생 가', '학생 다']); await expect(search).toHaveValue('');
  // Enter로 넣으면 초점이 찾는 칸에 남는다 — 빈 칸에서의 Ctrl+Z·Y는 연습본을 되돌린다.
  await search.press('Control+z'); await expect(roster.getByRole('columnheader')).toHaveText(['수업', '학생 가']);
  await search.press('Control+y'); await expect(roster.getByRole('columnheader')).toHaveText(['수업', '학생 가', '학생 다']);
  await expect(roster.getByLabel('학생 다 수 18:00 수업')).toBeChecked();
  // 표는 제 상자 안에서 스크롤한다 — 이름 줄은 붙어 있다.
  await expect(roster.locator('.roster-scroll')).toHaveCSS('overflow', 'auto'); await expect(roster.getByRole('columnheader').first()).toHaveCSS('position', 'sticky');
  await roster.getByRole('button', { name: '학생 다 이 반에서 빼기' }).click(); await expect(roster.getByRole('columnheader')).toHaveText(['수업', '학생 가']);
});
