// 시간표 주간 이동(타임머신) 순수 유틸 — ijw dateUtils.ts(getWeekReferenceDate) +
// TimetableManager.tsx(weekLabel) 충실 이식. 모든 함수는 "YYYY-MM-DD" 문자열 입출력.
// UTC 기준 파싱으로 서버 타임존 무관(결정적). ⚠️ server-only 금지 — 클라 week-nav도 import [[#61]].

function parse(d: string): Date {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, day ?? 1));
}
function fmt(dt: Date): string {
  return dt.toISOString().slice(0, 10);
}
/** d에서 days만큼 이동한 날짜(YYYY-MM-DD). */
export function shiftDays(d: string, days: number): string {
  const dt = parse(d);
  dt.setUTCDate(dt.getUTCDate() + days);
  return fmt(dt);
}

/** 그 날짜가 속한 주의 월요일(YYYY-MM-DD). 주 시작 = 월요일(ijw weekStartsOn:1). */
export function mondayOf(d: string): string {
  const dow = parse(d).getUTCDay(); // 0=일 .. 6=토
  const diff = dow === 0 ? -6 : 1 - dow; // 일요일이면 지난 월요일(-6)
  return shiftDays(d, diff);
}

/** 오늘이 속한 주의 월요일. */
export function thisMonday(today: string): string {
  return mondayOf(today);
}

/** 월요일에서 n주 이동. */
export function addWeeks(monday: string, n: number): string {
  return shiftDays(monday, n * 7);
}

/**
 * 주차 기준일 — ijw getWeekReferenceDate(dateUtils.ts:269-290) 그대로.
 * 미래 주(weekStart>today) → 그 주 월요일 / 이번 주 → 오늘 / 과거 주 → 그 주 일요일.
 * 학생 상태(대기/퇴원/신입)를 그 시점 기준으로 판정하기 위한 기준일.
 */
export function getWeekReferenceDate(weekStartMonday: string, today: string): string {
  if (weekStartMonday > today) return weekStartMonday; // 미래 주
  const weekEnd = shiftDays(weekStartMonday, 6); // 일요일
  if (today <= weekEnd) return today; // 이번 주
  return weekEnd; // 과거 주
}

/** 재구성 윈도우 끝 = referenceDate + 6 (ijw useSubjectClassStudents weekEnd). */
export function weekEndOf(referenceDate: string): string {
  return shiftDays(referenceDate, 6);
}

/**
 * 기준일이 속한 주의 일요일 — 스케줄 유효성(valid_from) 상한용.
 * ⚠️ weekEndOf(ref+6)는 롤링 창이라 과거 주(ref=일요일)에서 다음 주 목요일까지 뻗어,
 * 미래 시작 스케줄(valid_from이 그 6일 안)이 직전 과거 주에 새는 버그가 있었다
 * (2026-07-01 enrollment hasEnded 롤링 창 픽스와 같은 계열). 예정 학생 look-ahead(enrollment
 * fetch)는 의도적 롤링 창이라 weekEndOf 유지 — 스케줄 valid_from 판정만 이 함수를 쓴다.
 */
export function weekSundayOf(referenceDate: string): string {
  const dow = parse(referenceDate).getUTCDay(); // 0=일 .. 6=토
  return dow === 0 ? referenceDate : shiftDays(referenceDate, 7 - dow);
}

/** 기준일이 속한 달력 주의 월요일~일요일. 스케줄 유효기간 겹침 조회의 단일 경계. */
export function weekBoundsOf(referenceDate: string): { start: string; end: string } {
  return { start: mondayOf(referenceDate), end: weekSundayOf(referenceDate) };
}

/**
 * "2026년 6월 4주차" — 주차 **이름만**(날짜 범위 없이). 문장 안에 끼워 넣을 때 쓴다
 * (예: 시간표 학생 검색 0건 안내 "…이 2026년 6월 4주차 수학 시간표에 없습니다").
 * 네비 배지처럼 자리가 있는 곳은 범위까지 붙은 `weekLabel`을 그대로 쓸 것.
 */
export function weekTitle(monday: string): string {
  const m = parse(monday);
  const year = m.getUTCFullYear();
  const month = m.getUTCMonth() + 1;
  const firstDow = new Date(Date.UTC(year, m.getUTCMonth(), 1)).getUTCDay();
  const weekOfMonth = Math.ceil((m.getUTCDate() + firstDow) / 7);
  return `${year}년 ${month}월 ${weekOfMonth}주차`;
}

/**
 * "2026년 6월 4주차 (22일~28일)" — 달 경계면 "29일~7/5일". (ijw TimetableManager.tsx:2320-2335)
 * @param monday 그 주 월요일(YYYY-MM-DD)
 */
export function weekLabel(monday: string): string {
  const m = parse(monday);
  const month = m.getUTCMonth() + 1;
  const sun = parse(shiftDays(monday, 6));
  const startDay = m.getUTCDate();
  const endDay = sun.getUTCDate();
  const endMonth = sun.getUTCMonth() + 1;
  const range =
    month === endMonth ? `${startDay}일~${endDay}일` : `${startDay}일~${endMonth}/${endDay}일`;
  return `${weekTitle(monday)} (${range})`;
}

/** 오늘 기준 그 주가 과거/현재/미래 중 무엇인지 — 네비 배지·편집 가능 판정용. */
export function weekRelation(monday: string, today: string): "past" | "current" | "future" {
  const cur = thisMonday(today);
  if (monday === cur) return "current";
  return monday > cur ? "future" : "past";
}

/** 요일 키 → 그 주 월요일로부터의 오프셋(0=월 … 6=일). 시간표 축과 같은 순서. */
const DOW_OFFSET: Record<string, number> = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 };

/** 기준일이 속한 주에서 그 요일 칸의 **실제 날짜**. 모르는 요일 키는 null. */
export function dateOfDowInWeek(referenceDate: string, dow: string): string | null {
  const off = DOW_OFFSET[dow];
  return off === undefined ? null : shiftDays(mondayOf(referenceDate), off);
}

/**
 * 이 스케줄 행이 **그 요일 칸의 날짜에** 유효한가 — 주 단위가 아니라 **날짜 단위** 판정.
 *
 * 🔴 왜 필요한가(2026-08-04): 담당·강의실이 바뀌면 옛 행을 어제까지로 마감하고 새 행을 오늘부터 여는데,
 *    변경이 일어난 주에는 **두 행 모두 그 주와 겹친다**. 주 단위로만 거르면 같은 칸에 반이 두 번 그려진다.
 *    날짜로 판정하면 월·화는 옛 담당, 수요일부터 새 담당 — **실제로 일어난 그대로** 그려진다.
 * ⚠️ 유효기간이 없는(둘 다 null) 행은 항상 통과 — 판정 불가를 '없음'으로 바꾸지 않는다.
 */
export function slotLiveOnDate(
  slot: { dayOfWeek: string; validFrom?: string | null; validTo?: string | null },
  referenceDate: string,
): boolean {
  const date = dateOfDowInWeek(referenceDate, slot.dayOfWeek);
  if (!date) return true; // 모르는 요일 키는 거르지 않는다(데이터가 사라지는 쪽으로 실패하지 않게)
  const from = slot.validFrom ? String(slot.validFrom).slice(0, 10) : null;
  const to = slot.validTo ? String(slot.validTo).slice(0, 10) : null;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}
