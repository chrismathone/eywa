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

// 기존 소비처 호환 re-export. 매처의 진실원본은 시간표 전체가 함께 쓰는 period-match.ts다.
export {
  buildPeriodMatcher,
  type PeriodMatchRow,
} from "@/features/timetable/lib/period-match";

/**
 * 슬롯 목록 → { grid, custom }.
 *  · `grid`   = 그 요일 종류(평일/주말) 교시표에 **시작시각이 있는** 슬롯 → 클릭그리드가 셀로 복원한다.
 *  · `custom` = 나머지 → 자유 시각 행으로 실어 보낸다(안 실으면 저장 시 삭제된다).
 * ⚠️ 판정 기준은 그리드(`schedule-grid.tsx`)의 역매핑과 **같아야** 한다 — 시작·종료 짝 우선,
 *    레거시 종료시각만 시작시각으로 폴백한다.
 */
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
