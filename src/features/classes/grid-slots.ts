/**
 * 반 스케줄을 "교시 클릭그리드로 표현되는 것" vs "자유 시각 행으로 표현할 것"으로 나눈다 — 순수(Vitest).
 *
 * 🔴 왜 필요한가: 클릭그리드는 **교시표에 있는 시작시각만** 셀로 만든다. 교시표에 없는 시각의 슬롯은
 *    화면에 아예 안 나오고, 그 상태로 저장하면 `updateClass`의 delete → 재insert에서 **영구 삭제**된다
 *    (실측 injaewon: 939행 중 69행이 해당 과목/주말 교시표 밖 시작시각, 그중 8행은 활성 반의 살아있는 행 —
 *    예: '고등E_고2 심화' 토 14:20·15:40). 저장 성공 토스트만 뜨고 토요일 두 교시가 사라진다.
 *
 * 또 하나: 방학 **오전 특강**(09~14시)은 평일 교시표(14:30~ / 영어 14:20~)에 칸 자체가 없어 클릭그리드로는
 * 만들 수 없다. 자유 시각 행이 그 입력 경로다(원장 요구 2026-07-22 "특강 토글 + 특강 전용 시간표").
 */

export type PeriodRow = { startTime: string };

export type GridSlotInput = {
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  teacherId?: string | null;
  classroomId?: string | null;
};

const hm = (t: string) => String(t).slice(0, 5);
const isWeekendDay = (d: string) => d === "sat" || d === "sun";

/**
 * 슬롯 목록 → { grid, custom }.
 *  · `grid`   = 그 요일 종류(평일/주말) 교시표에 **시작시각이 있는** 슬롯 → 클릭그리드가 셀로 복원한다.
 *  · `custom` = 나머지 → 자유 시각 행으로 실어 보낸다(안 실으면 저장 시 삭제된다).
 * ⚠️ 판정 기준은 그리드(`schedule-grid.tsx`)의 역매핑과 **같아야** 한다 — 시작시각만 본다.
 */
export type PeriodMatchRow = { id: string; startTime: string; endTime: string };

/**
 * 저장된 슬롯 → 교시 id 역매핑기(요일 종류별로 하나씩 만들어 쓴다).
 *
 * 🔴 시작시각만으로는 못 가른다: 학원설정에 **시작이 같은 교시가 둘** 있을 수 있다(실측 injaewon 영어:
 *    EiE 4교시 16:20~17:00 과 IJW 1교시 16:20~17:20). 시작시각만 보고 매핑하면 4교시에 찍어 저장한 수업이
 *    반정보를 다시 열 때 IJW 1교시 칸에 나타나고, 그대로 저장하면 종료시각이 17:20으로 **바뀐다**.
 *    → (시작,종료) 짝을 먼저 맞춘다.
 * ⚠️ 시작시각 폴백은 반드시 남긴다: splitGridSlots가 "시작시각이 표에 있으면 그리드"로 분류하므로,
 *    폴백이 없으면 종료시각이 표와 어긋난 슬롯이 그리드에서 사라지고 저장 시 삭제된다(이 파일 상단 경고).
 * 같은 짝·같은 시작이 여러 개면 **먼저 나온 교시**(작은 번호)를 쓴다 — 시간표 축(weekday-group-tables)과 동일 규약.
 */
export function buildPeriodMatcher(periods: PeriodMatchRow[]) {
  const exact = new Map<string, string>();
  const byStart = new Map<string, string>();
  for (const p of periods) {
    const pair = `${hm(p.startTime)}|${hm(p.endTime)}`;
    if (!exact.has(pair)) exact.set(pair, p.id);
    if (!byStart.has(hm(p.startTime))) byStart.set(hm(p.startTime), p.id);
  }
  return (slot: { startTime: string; endTime?: string | null }): string | null =>
    exact.get(`${hm(slot.startTime)}|${hm(slot.endTime ?? "")}`) ?? byStart.get(hm(slot.startTime)) ?? null;
}

export function splitGridSlots<T extends GridSlotInput>(input: {
  slots: T[];
  weekdayPeriods: PeriodRow[];
  weekendPeriods: PeriodRow[];
}): { grid: T[]; custom: T[] } {
  const wd = new Set(input.weekdayPeriods.map((p) => hm(p.startTime)));
  const we = new Set(input.weekendPeriods.map((p) => hm(p.startTime)));
  const grid: T[] = [];
  const custom: T[] = [];
  for (const s of input.slots) {
    const table = isWeekendDay(s.dayOfWeek) ? we : wd;
    (table.has(hm(s.startTime)) ? grid : custom).push(s);
  }
  return { grid, custom };
}
