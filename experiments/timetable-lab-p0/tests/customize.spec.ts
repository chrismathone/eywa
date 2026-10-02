import { expect, test, type Page } from '@playwright/test';

// 예제: 영어 A(월 18~19, 강사 가, 201, 학생 가) · 영어 B(화 18~19, 강사 나, 202, 학생 나) · 영어 C(목 19~20, 강사 가, 201, 학생 다)
const block = (page: Page, id: string) => page.locator(`[data-block-id="${id}"]`);
const status = (page: Page) => page.locator('.lab-status [role=status]');
const blocks = (page: Page) => page.locator('.lesson-block');
/** 강사·요일 칸에서 그 시각의 화면 좌표. 18:00 수업의 위치와 높이에서 10분의 높이를 잰다. */
async function point(page: Page, teacher: string, day: string, time: string) {
  const anchor = (await block(page, 'placement-1').boundingBox())!, lane = (await page.locator(`[data-lane="${teacher}"][data-day="${day}"]`).boundingBox())!;
  const [h, m] = time.split(':').map(Number), unit = anchor.height / 6;
  return { x: lane.x + lane.width / 2, y: anchor.y + (h * 60 + m - 1080) / 10 * unit + unit / 2 };
}
const draftOf = (page: Page) => page.evaluate(() => window.labProbe!.getSnapshot().draft);
const undo = (page: Page) => page.getByRole('button', { name: '되돌리기', exact: true }).click();

test.beforeEach(async ({ page }) => { await page.goto('/?sample=1'); await expect(block(page, 'placement-1')).toBeVisible(); });

test('adds a new class from the dialog with a live clash check, then undoes it in one step', async ({ page }) => {
  await page.getByRole('button', { name: '＋ 추가' }).click();
  const dialog = page.getByRole('dialog', { name: '새 항목 추가' });
  await dialog.getByRole('radio', { name: '새 반' }).click(); await dialog.getByLabel('이름').fill('영어 A');
  await expect(dialog.getByRole('alert')).toContainText('이미 있는 반'); await expect(dialog.getByRole('button', { name: '추가', exact: true })).toBeDisabled();
  await dialog.getByLabel('이름').fill('영어 D'); await dialog.getByLabel('요일').selectOption('월'); await dialog.getByLabel('강사').selectOption('강사 가');
  await dialog.getByLabel('시작').fill('18:00'); await dialog.getByLabel('종료').fill('19:00');
  await expect(dialog.locator('.lab-conflict')).toContainText('겹침이 1건');
  await dialog.getByLabel('요일').selectOption('금'); await dialog.getByLabel('강의실').fill('203');
  await expect(dialog.locator('.clear-check')).toContainText('겹치는 수업이 없습니다');
  await dialog.getByRole('button', { name: '추가', exact: true }).click(); await expect(dialog).toHaveCount(0);
  await expect(blocks(page)).toHaveCount(4); await expect(page.locator('.lesson-block.is-selected')).toContainText('영어 D');
  await page.getByRole('tab', { name: '통합뷰' }).click(); await expect(page.locator('.integrated-class .class-name-row', { hasText: '영어 D' })).toBeVisible();
  await undo(page); await expect(page.locator('.integrated-class .class-name-row', { hasText: '영어 D' })).toHaveCount(0);
});

test('drawing on an empty lane opens the add dialog with that range; double-click seeds the start', async ({ page }) => {
  const from = await point(page, '강사 나', '수', '17:00'), to = await point(page, '강사 나', '수', '17:50');
  await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 6 });
  await expect(page.locator('.draw-preview')).toContainText('17:00~18:00 · 60분'); await page.mouse.up();
  const dialog = page.getByRole('dialog', { name: '새 항목 추가' });
  await expect(dialog.getByLabel('시작')).toHaveValue('17:00'); await expect(dialog.getByLabel('종료')).toHaveValue('18:00');
  await expect(dialog.getByLabel('요일')).toHaveValue('수'); await expect(dialog.getByLabel('강사')).toHaveValue('강사 나');
  await dialog.getByRole('radio', { name: '회의·일정' }).click(); await dialog.getByLabel('이름').fill('강사 회의');
  await dialog.getByRole('button', { name: '추가', exact: true }).click();
  await expect(page.locator('.lesson-block', { hasText: '강사 회의' })).toHaveAttribute('title', /수 17:00–18:00/);
  const spot = await point(page, '강사 가', '금', '16:00'); await page.mouse.dblclick(spot.x, spot.y);
  await expect(dialog.getByLabel('시작')).toHaveValue('16:00'); await expect(dialog.getByLabel('요일')).toHaveValue('금');
  await dialog.getByRole('button', { name: '추가 창 닫기' }).click(); await expect(blocks(page)).toHaveCount(4);
});

test('dragging shows free places in green and the reason for a clash before dropping; Alt+drag copies', async ({ page }) => {
  const c = (await block(page, 'placement-3').boundingBox())!, clash = await point(page, '강사 가', '월', '18:00');
  await page.mouse.move(c.x + c.width / 2, c.y + 20); await page.mouse.down(); await page.mouse.move(clash.x, clash.y + 14, { steps: 8 });
  await expect(page.locator('.free-band').first()).toBeVisible();
  // 월요일 강사 가 칸은 18~19시에 영어 A가 있어, 60분 수업을 겹침 없이 놓을 자리 띠가 그 시간을 덮지 않는다.
  expect(await page.locator('[data-lane="강사 가"][data-day="월"] .free-band').count()).toBeGreaterThan(1);
  await expect(page.locator('.drag-preview.has-clash')).toContainText('겹침'); await expect(page.locator('.drag-reason')).toContainText('강사·강의실 겹침');
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(block(page, 'placement-3')).toHaveAttribute('title', /목 19:00–20:00/); await expect(page.locator('.free-band')).toHaveCount(0);
  const b = (await block(page, 'placement-2').boundingBox())!, target = await point(page, '강사 나', '목', '18:00');
  await page.mouse.move(b.x + b.width / 2, b.y + 20); await page.mouse.down(); await page.keyboard.down('Alt');
  await page.mouse.move(target.x, target.y + 14, { steps: 8 }); await expect(page.locator('.drag-preview.is-clear')).toContainText('복제');
  await page.mouse.up(); await page.keyboard.up('Alt');
  await expect(blocks(page)).toHaveCount(4); await expect(block(page, 'placement-2')).toHaveAttribute('title', /화 18:00–19:00/);
  await expect(page.locator('.lesson-block.is-selected')).toHaveAttribute('title', /영어 B · 목 18:00–19:00/);
});

test('resizes by the bottom edge inside operating hours and refuses to cross them', async ({ page }) => {
  const a = block(page, 'placement-1'), box = (await a.boundingBox())!, unit = box.height / 6;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 2 + unit * 2, { steps: 5 });
  await expect(a.locator('.resize-time')).toContainText('18:00~19:20'); await page.mouse.up();
  await expect(a).toHaveAttribute('title', /18:00–19:20/); await expect(status(page)).toContainText('80분');
  const grown = (await a.boundingBox())!;
  await page.mouse.move(grown.x + grown.width / 2, grown.y + grown.height - 2); await page.mouse.down();
  await page.mouse.move(grown.x + grown.width / 2, grown.y + grown.height - 2 + unit * 12, { steps: 5 });
  await expect(a).toHaveClass(/is-blocked/); await page.mouse.up();
  await expect(status(page)).toContainText('운영시간'); await expect(a).toHaveAttribute('title', /18:00–19:20/);
});

test('Shift+drag selects every lesson in the rectangle and the toolbar edits them together', async ({ page }) => {
  const from = await point(page, '강사 가', '금', '17:30'), to = await point(page, '강사 가', '월', '19:30');
  await page.keyboard.down('Shift'); await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 }); await expect(page.locator('.marquee')).toBeVisible(); await page.mouse.up(); await page.keyboard.up('Shift');
  const bar = page.getByRole('toolbar', { name: '고른 수업 도구' });
  await expect(bar).toContainText('2개 선택'); await expect(block(page, 'placement-1')).toHaveAttribute('aria-pressed', 'true'); await expect(block(page, 'placement-3')).toHaveAttribute('aria-pressed', 'true');
  await bar.getByRole('button', { name: '10분 뒤로' }).click();
  await expect(block(page, 'placement-1')).toHaveAttribute('title', /18:10–19:10/); await expect(block(page, 'placement-3')).toHaveAttribute('title', /19:10–20:10/);
  await bar.getByRole('button', { name: '두 수업 자리 맞바꾸기' }).click();
  await expect(block(page, 'placement-1')).toHaveAttribute('title', /목 19:10–20:10/); await expect(block(page, 'placement-3')).toHaveAttribute('title', /월 18:10–19:10/);
  await undo(page); await undo(page); await expect(block(page, 'placement-1')).toHaveAttribute('title', /월 18:00–19:00/);
});

test('the right-click menu locks a lesson against moving, resizing and deleting until unlocked', async ({ page }) => {
  const a = block(page, 'placement-1'); await a.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '잠그기(실수로 못 옮기게)' }).click(); await expect(a.locator('.lock-mark')).toBeVisible();
  await page.keyboard.press('Delete'); await expect(status(page)).toContainText('잠근 수업'); await expect(a).toBeVisible();
  const box = (await a.boundingBox())!, target = await point(page, '강사 가', '수', '18:00');
  await page.mouse.move(box.x + box.width / 2, box.y + 20); await page.mouse.down(); await page.mouse.move(target.x, target.y + 14, { steps: 6 });
  await expect(page.locator('.drag-preview.is-blocked')).toContainText('놓을 수 없음'); await page.mouse.up();
  await expect(a).toHaveAttribute('title', /월 18:00–19:00 .* 잠금/);
  await a.click({ button: 'right' }); await page.getByRole('menuitem', { name: '잠금 풀기' }).click(); await expect(a.locator('.lock-mark')).toHaveCount(0);
  await a.click({ button: 'right' }); await page.getByRole('menuitem', { name: '수요일에도 놓기' }).click();
  await expect(page.locator('.lesson-block', { hasText: '영어 A' })).toHaveCount(2);
});

test('keyboard: Alt+arrows nudge and hop lanes, Shift+arrows resize, Ctrl+D duplicates, Insert adds at the cursor', async ({ page }) => {
  const a = block(page, 'placement-1'); await a.click();
  await page.keyboard.press('Control+d'); await expect(page.locator('.lesson-block', { hasText: '영어 A' })).toHaveCount(2);
  await expect(status(page)).toContainText('복제'); await expect(page.locator('.lesson-block', { hasText: '영어 A' }).nth(1)).toHaveAttribute('title', /월 19:00–20:00/);
  await page.keyboard.press('Alt+ArrowDown'); await expect(a).toHaveAttribute('title', /18:10–19:10/);
  await page.keyboard.press('Shift+ArrowDown'); await expect(a).toHaveAttribute('title', /18:10–19:20/);
  await page.keyboard.press('Alt+ArrowRight'); await expect(a).toHaveAttribute('title', /화 18:10–19:20/);
  // 운영시간(20:10까지)을 넘겨 복제할 자리가 없으면 이유를 알리고 그대로 둔다.
  await page.keyboard.press('Control+d'); await expect(status(page)).toContainText('운영시간'); await expect(page.locator('.lesson-block', { hasText: '영어 A' })).toHaveCount(2);
  await page.keyboard.press('Insert');
  await expect(page.getByRole('dialog', { name: '새 항목 추가' }).getByLabel('요일')).toHaveValue('월');
});

test('teacher columns: add, rename everywhere, hand over all lessons, reorder, and remove only when empty', async ({ page }) => {
  await page.getByRole('button', { name: '강사 가', exact: true }).click(); await page.getByRole('menuitem', { name: '새 강사 열 추가' }).click();
  const add = page.getByRole('dialog', { name: '새 항목 추가' }); await add.getByLabel('이름').fill('강사 다'); await add.getByRole('button', { name: '추가', exact: true }).click();
  await expect(page.locator('[data-lane="강사 다"]')).toHaveCount(5);
  await page.getByRole('button', { name: '관리', exact: true }).click(); const manage = page.getByRole('dialog', { name: '강사·학생·반·강의실 관리' });
  await manage.getByLabel('강사 나 이름').fill('강사 라'); await manage.getByRole('group', { name: '강사 나 강사' }).getByRole('button', { name: '이름 바꾸기' }).click();
  await expect(block(page, 'placement-2')).toHaveAttribute('aria-label', /강사 라$/);
  await manage.getByRole('group', { name: '강사 가 강사' }).getByRole('button', { name: '지우기' }).click();
  // 아래 상태줄은 창에 가려 안 보인다 — 안 된 이유가 창 안에 뜬다.
  await expect(manage.getByRole('alert')).toContainText('수업·일정 2개가 남아 있습니다');
  await manage.getByLabel('강사 가의 수업을 넘기거나 맞바꿀 강사').selectOption('give|강사 다');
  await expect(block(page, 'placement-1')).toHaveAttribute('aria-label', /강사 다$/); await expect(block(page, 'placement-3')).toHaveAttribute('aria-label', /강사 다$/);
  await manage.getByRole('group', { name: '강사 가 강사' }).getByRole('button', { name: '지우기' }).click(); await expect(manage.getByRole('group', { name: '강사 가 강사' })).toHaveCount(0);
  await manage.getByRole('button', { name: '강사 다 왼쪽으로' }).click();
  await manage.getByRole('button', { name: '관리 창 닫기' }).click();
  await expect(page.locator('.week-teacher-heading')).toHaveText(['강사 다', '강사 라']);
  expect((await draftOf(page)).teachers).toEqual(['강사 다', '강사 라']);
});

test('students: create, enrol in a second class, choose which days they come, and follow their week', async ({ page }) => {
  await page.evaluate(() => {
    const store = window.labProbe!, next = structuredClone(store.getSnapshot().draft), row = next.cells.length;
    next.cells.push(next.cells[1].map(c => ({ ...c }))); next.cells[row][1].text = '수';
    next.placements.push({ ...next.placements[0], id: 'a-wed', row }); store.commit('test second day', next);
  });
  await page.getByRole('button', { name: '관리', exact: true }).click(); const manage = page.getByRole('dialog', { name: '강사·학생·반·강의실 관리' });
  await manage.getByRole('tab', { name: '학생' }).click(); await manage.getByRole('button', { name: '＋ 새 학생' }).click();
  const add = page.getByRole('dialog', { name: '새 항목 추가' }); await add.getByLabel('이름').fill('학생 라'); await add.getByLabel('넣을 반').selectOption({ label: '영어 B' });
  await add.getByRole('button', { name: '추가', exact: true }).click();
  await expect(manage.getByRole('group', { name: '학생 라 학생' })).toContainText('영어 B');
  await manage.getByLabel('학생 가 넣을 반').selectOption({ label: '영어 B' });
  await expect(manage.getByRole('group', { name: '학생 가 학생' })).toContainText('영어 A'); await expect(manage.getByRole('group', { name: '학생 가 학생' })).toContainText('영어 B');
  await manage.getByRole('group', { name: '학생 가 학생' }).getByRole('button', { name: '동선 보기' }).click(); await expect(manage).toHaveCount(0);
  const trail = page.getByRole('status', { name: '학생 가 주간 동선' });
  await expect(trail).toContainText('월 18:00 영어 A → 화 18:00 영어 B → 수 18:00 영어 A');
  await expect(block(page, 'placement-3')).toHaveClass(/is-dim/); await expect(block(page, 'placement-1')).toHaveClass(/is-trail/);
  await trail.getByRole('button', { name: '강조 끄기' }).click(); await expect(page.locator('.is-dim')).toHaveCount(0);
  await block(page, 'placement-1').dblclick(); const roster = page.getByRole('region', { name: '반 학생 편집' });
  await roster.getByLabel('학생 가 수 18:00 수업').uncheck();
  expect((await draftOf(page)).placements.find(p => p.id === 'a-wed')!.studentIds).toEqual([]);
  expect((await draftOf(page)).placements.find(p => p.id === 'placement-1')!.studentIds).toEqual(['s1']);
  await roster.getByLabel('넣을 학생').selectOption({ label: '학생 다' }); await roster.getByRole('button', { name: '이 반에 넣기' }).click();
  await expect(roster.getByRole('button', { name: '학생 다', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '요약', exact: true }).click();
  await expect(page.getByRole('complementary', { name: '연습본 요약' })).toContainText('두 반 이상 2명');
});

test('integrated view: Ctrl+drag enrols in a second class without leaving the first; the class menu deletes a class', async ({ page }) => {
  await page.getByRole('tab', { name: '통합뷰' }).click();
  const from = page.locator('[data-class-id="class-1"] [data-student-id="s1"]'), to = page.locator('[data-class-id="class-2"] .integrated-roster');
  const a = (await from.boundingBox())!, b = (await to.boundingBox())!;
  await page.keyboard.down('Control'); await page.mouse.move(a.x + 25, a.y + 13); await page.mouse.down();
  await page.mouse.move(b.x + 25, b.y + 13, { steps: 8 }); await expect(page.locator('.roster-drag-ghost')).toContainText('이 반에도 넣기');
  await page.mouse.up(); await page.keyboard.up('Control');
  await expect(from).toBeVisible(); await expect(page.locator('[data-class-id="class-2"] [data-student-id="s1"]')).toBeVisible();
  await expect(page.locator('.roster-drag-ghost')).toBeHidden();
  await page.locator('[data-class-id="class-3"] .class-name-row').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '영어 C 반 지우기' }).click(); await expect(page.locator('[data-class-id="class-3"]')).toHaveCount(0);
  await undo(page); await expect(page.locator('[data-class-id="class-3"]')).toBeVisible();
});

test('the history list rolls back several steps at once and redo restores them', async ({ page }) => {
  const a = block(page, 'placement-1'); await a.click();
  await page.keyboard.press('Control+d'); await expect(blocks(page)).toHaveCount(4);
  await page.keyboard.press('Alt+ArrowUp'); await page.keyboard.press('Alt+ArrowUp'); await expect(a).toHaveAttribute('title', /17:40–18:40/);
  await page.getByRole('button', { name: '기록', exact: true }).click();
  await expect(page.getByRole('menuitem')).toHaveCount(3); await page.getByRole('menuitem', { name: /^2단계 전/ }).click();
  await expect(blocks(page)).toHaveCount(4); await expect(a).toHaveAttribute('title', /18:00–19:00/);
  await page.getByRole('button', { name: '기록', exact: true }).click(); await page.getByRole('menuitem', { name: /^1단계 전/ }).click(); await expect(blocks(page)).toHaveCount(3);
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: '다시 실행', exact: true }).click();
  await expect(blocks(page)).toHaveCount(4); await expect(a).toHaveAttribute('title', /17:40–18:40/);
});

test('starting from nothing: a teacher column, a class and a student can all be made by hand', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: '빈 시간표에서 직접 만들기' }).click();
  const add = page.getByRole('dialog', { name: '새 항목 추가' }); await add.getByLabel('계속 추가').check();
  await add.getByLabel('이름').fill('김 선생'); await add.getByRole('button', { name: '추가', exact: true }).click();
  await add.getByRole('radio', { name: '새 반' }).click(); await add.getByLabel('이름').fill('초등 영어'); await add.getByLabel('시작').fill('15:00'); await add.getByLabel('종료').fill('16:00');
  await add.getByRole('button', { name: '추가', exact: true }).click();
  await add.getByRole('radio', { name: '학생' }).click(); await add.getByLabel('이름').fill('새 학생'); await add.getByLabel('넣을 반').selectOption({ label: '초등 영어' });
  await add.getByRole('button', { name: '추가', exact: true }).click(); await add.getByRole('button', { name: '추가 창 닫기' }).click();
  await expect(page.locator('.lesson-block')).toContainText('초등 영어');
  const draft = await draftOf(page);
  expect(draft.teachers).toEqual(['김 선생']); expect(Object.values(draft.people ?? {})).toEqual(['새 학생']);
  expect(draft.placements).toHaveLength(1); expect(draft.placements[0].studentIds).toHaveLength(1);
});

test('a locked lesson gets no “other time” suggestion; undoing an added lesson drops it from the selection; an emptied teacher column stays', async ({ page }) => {
  const a = block(page, 'placement-1'); await a.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '잠그기(실수로 못 옮기게)' }).click(); await a.dblclick();
  const panel = page.locator('.lab-inspector');
  await expect(panel).toContainText('잠근 수업이라 다른 시간을 찾지 않습니다'); await expect(panel.getByRole('button', { name: '겹치지 않는 시간 찾기' })).toHaveCount(0);
  await page.getByRole('button', { name: '확인 패널 닫기' }).click();
  // 복제해 생긴 수업이 선택된 채로 되돌리면, 사라진 수업은 선택에서도 빠진다(다음 조작을 막지 않는다).
  const b = block(page, 'placement-2'), start = (await b.boundingBox())!, copyTo = await point(page, '강사 나', '목', '18:00');
  await page.mouse.move(start.x + start.width / 2, start.y + 20); await page.mouse.down(); await page.keyboard.down('Alt');
  await page.mouse.move(copyTo.x, copyTo.y + 14, { steps: 8 }); await page.mouse.up(); await page.keyboard.up('Alt');
  await expect(page.getByRole('toolbar', { name: '고른 수업 도구' })).toContainText('1개 선택'); await expect(blocks(page)).toHaveCount(4);
  await expect(b).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Control+z'); await expect(blocks(page)).toHaveCount(3);
  await expect(page.getByRole('toolbar', { name: '고른 수업 도구' })).toHaveCount(0);
  // 강사 나의 하나뿐인 수업을 강사 가 칸으로 옮겨도 강사 나 열은 남고, 다시 그 열에 놓을 수 있다.
  const box = (await b.boundingBox())!, to = await point(page, '강사 가', '수', '18:00');
  await page.mouse.move(box.x + box.width / 2, box.y + 20); await page.mouse.down(); await page.mouse.move(to.x, to.y + 14, { steps: 8 }); await page.mouse.up();
  await expect(b).toHaveAttribute('aria-label', /강사 가$/); await expect(page.locator('[data-lane="강사 나"]')).not.toHaveCount(0);
  await expect(page.locator('.week-teacher-heading')).toHaveText(['강사 가', '강사 나']);
  // 초점이 시간표 밖(본문)에 있어도 Ctrl+Z가 듣는다.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()); await page.keyboard.press('Control+z');
  await expect(b).toHaveAttribute('aria-label', /강사 나$/);
});
