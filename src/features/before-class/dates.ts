/**
 * 비포클래스체크리스트 — 그 달 **수업일** 목록(순수 · Vitest).
 * 반의 배치 행(`class_schedules`)은 이력을 함께 담는다([[#88]]) — 날짜마다 그날 살아 있는 행(valid_from ≤ 날 ≤ valid_to)의
 * 요일만 수업일로 센다. 휴일·휴원일은 거르지 않는다(초안 — 체크가 없으면 빈 칸으로 남을 뿐이다).
 */

export type ScheduleRow = { day_of_week: string; valid_from: string | null; valid_to: string | null };

const DOW = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const DOW_KO: Record<string, string> = { sun: "일", mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토" };

export function dayKeyOf(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

export function dayLabelKo(ymd: string): string {
  return DOW_KO[dayKeyOf(ymd)] ?? "";
}

/** "10/26(월)" — 시트 머리 표기 그대로. */
export function shortDateLabel(ymd: string): string {
  const [, m, d] = ymd.split("-").map(Number);
  return `${m}/${d}(${dayLabelKo(ymd)})`;
}

function daysInMonth(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

/** 그 달(YYYY-MM)에서 이 반이 수업하는 날짜 — 오름차순. */
export function classDatesInMonth(month: string, schedules: readonly ScheduleRow[]): string[] {
  return daysInMonth(month).filter((date) => {
    const key = dayKeyOf(date);
    return schedules.some((s) => s.day_of_week === key && (!s.valid_from || s.valid_from <= date) && (!s.valid_to || s.valid_to >= date));
  });
}

/** 처음 고를 날 — 오늘이 수업일이면 오늘, 아니면 오늘 이전 마지막 수업일, 그것도 없으면 첫 수업일. */
export function defaultCheckDate(dates: readonly string[], today: string): string | null {
  if (dates.includes(today)) return today;
  const past = dates.filter((d) => d < today);
  return past.at(-1) ?? dates[0] ?? null;
}
