// 분리등원(월목 반의 월-only 학생 등) 표시용 순수 헬퍼 — 시간표 셀(class-cell)이 소비.
// enrollments.attendance_days(요일 enum, 빈 배열=전 요일 등원)를 화면 요일 라벨로.

export const DAY_LABEL: Record<string, string> = {
  mon: "월",
  tue: "화",
  wed: "수",
  thu: "목",
  fri: "금",
  sat: "토",
  sun: "일",
};

/**
 * 전입 예정(도착 셀) 학생의 "이 셀에서 오는 요일" 라벨 — 분리등원 학생이면 [월] 같은 표시용.
 * - attendanceDays 비면(=전 요일 등원) → "" (라벨 없음, 분리 아님).
 * - coveringDays(이 셀이 덮는 요일)와 교집합해 이 셀 기준 요일만.
 * - 이 셀의 전 요일을 다 오면(=이 셀에선 분리 아님) → "" (중복 라벨 생략).
 * - 교집합이 비면(등원 요일이 이 셀 요일과 안 겹치는 교차 이동) → 학생의 실제 등원 요일을 그대로.
 * 반환은 "월" 또는 "월·목" 형태(대괄호는 호출부에서).
 */
export function incomingDayLabel(
  attendanceDays: string[] | undefined,
  coveringDays: string[],
): string {
  const ad = attendanceDays ?? [];
  if (ad.length === 0) return "";
  const here = coveringDays.length > 0 ? coveringDays.filter((d) => ad.includes(d)) : ad;
  // 이 셀의 모든 요일을 다 오면 분리 아님 → 라벨 생략.
  if (coveringDays.length > 0 && here.length === coveringDays.length) return "";
  const show = here.length > 0 ? here : ad;
  return show.map((d) => DAY_LABEL[d] ?? d).join("·");
}

/**
 * 드롭 존 → 목적지 등원 요일(반이동 시 attendance_days). ijw useStudentDragDrop의 toZone 규칙:
 *   - 요일 존(day 지정) = [그 요일] → 그 요일만 등원(분리등원)
 *   - 공통 존(day 없음/null) = [] → 전 요일 등원(분리 아님)
 * 목 칸에 드롭하면 ['thu'], 상단 공통 목록에 드롭하면 [].
 */
export function zoneAttendanceDays(day: string | null | undefined): string[] {
  return day ? [day] : [];
}

/** 두 요일 집합이 같은지(순서 무관). 같은 반 요일 편집의 no-op(변경 없음) 판정용. */
export function sameDaySet(a: string[] | undefined, b: string[] | undefined): boolean {
  const sa = new Set(a ?? []);
  const sb = new Set(b ?? []);
  if (sa.size !== sb.size) return false;
  for (const x of sa) if (!sb.has(x)) return false;
  return true;
}

/** 같은 반 요일 편집 배지 라벨 — []=전 요일, ['thu']="목만", ['mon','thu']="월·목만". */
export function dayChangeLabel(days: string[] | undefined): string {
  const d = days ?? [];
  if (d.length === 0) return "전 요일";
  return d.map((x) => DAY_LABEL[x] ?? x).join("·") + "만";
}
