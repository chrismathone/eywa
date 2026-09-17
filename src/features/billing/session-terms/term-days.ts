/** 요일 번호(0=일 … 6=토) — 코드 고정 축(학원설정 enum 아님). 표시는 월요일부터. */
const LABEL = ["일", "월", "화", "수", "목", "금", "토"] as const;
const ORDER = [1, 2, 3, 4, 5, 6, 0];
export const DOW_NUMBER: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

/** `[4, 1]` → `월·목`. 비어 있으면 빈 문자열. */
export function formatTermDays(days: readonly number[] | null | undefined): string {
  if (!days?.length) return "";
  const set = new Set(days);
  return ORDER.filter((d) => set.has(d)).map((d) => LABEL[d]).join("·");
}

/**
 * 회차 확정 표의 요일 두 가지(원장 2026-09-17 *"수업명 옆에는 이 수업의 스케줄 요일, 학생 옆에는 스케줄과 다를시 개별 등원요일"*).
 * - `classDays` — 그 달에 걸친 반 배치(class_schedules)의 요일 합.
 * - `attendDays` — 그 학생의 수강(휴원 제외, 그 달과 겹침) 등원 요일 ∩ 반 요일. 예정 시수(`plan.ts`)와 같은 교집합이다 —
 *   반이 옮겨 가 이제 없는 요일이 등원 요일에 남아 있어도 그 요일은 안 보인다. **하나라도 비어 있으면**(= 반 요일 전부)·교집합이
 *   반 요일과 같거나 비었으면·그 달 반 배치가 없으면 null(리뷰 2026-09-17: 배치 없는 달에 "개별 등원"이 서던 것).
 */
export function individualAttendDays(
  classDays: readonly number[],
  enrollments: readonly { attendanceDays: readonly string[] | null }[],
): number[] | null {
  if (enrollments.length === 0 || classDays.length === 0) return null;
  const cls = new Set(classDays);
  const days = new Set<number>();
  for (const e of enrollments) {
    const mapped = (e.attendanceDays ?? []).map((d) => DOW_NUMBER[d]).filter((d): d is number => d !== undefined);
    if (mapped.length === 0) return null;
    for (const d of mapped) if (cls.has(d)) days.add(d);
  }
  if (days.size === 0 || days.size === cls.size) return null;
  return ORDER.filter((d) => days.has(d));
}
