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
 * "2026년 6월 4주차 (22일~28일)" — 달 경계면 "29일~7/5일". (ijw TimetableManager.tsx:2320-2335)
 * @param monday 그 주 월요일(YYYY-MM-DD)
 */
export function weekLabel(monday: string): string {
  const m = parse(monday);
  const year = m.getUTCFullYear();
  const month = m.getUTCMonth() + 1;
  const firstDow = new Date(Date.UTC(year, m.getUTCMonth(), 1)).getUTCDay();
  const weekOfMonth = Math.ceil((m.getUTCDate() + firstDow) / 7);
  const sun = parse(shiftDays(monday, 6));
  const startDay = m.getUTCDate();
  const endDay = sun.getUTCDate();
  const endMonth = sun.getUTCMonth() + 1;
  const range =
    month === endMonth ? `${startDay}일~${endDay}일` : `${startDay}일~${endMonth}/${endDay}일`;
  return `${year}년 ${month}월 ${weekOfMonth}주차 (${range})`;
}

/** 오늘 기준 그 주가 과거/현재/미래 중 무엇인지 — 네비 배지·편집 가능 판정용. */
export function weekRelation(monday: string, today: string): "past" | "current" | "future" {
  const cur = thisMonday(today);
  if (monday === cur) return "current";
  return monday > cur ? "future" : "past";
}
