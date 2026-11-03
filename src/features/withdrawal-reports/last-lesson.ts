import { effectiveAttendanceRecords, type EffectiveAttendanceRecord } from "@/features/attendance/effective-records";

/**
 * 요청 창의 '마지막 수업일' 자동 채움(원장 2026-11-03) — 고른 반에서 학생이 **마지막으로 수업을 들은 날**.
 * 정정이 반영된 출결(같은 학생·반·수업일·교시의 마지막 기록 — `effectiveAttendanceRecords`) 중 출석·지각·조퇴·보강, 오늘(KST) 이하.
 * 결석·공결은 들은 날이 아니다. 없으면 null(창은 오늘로 둔다).
 */
export const ATTENDED_STATUSES: readonly string[] = ["present", "late", "early_leave", "makeup"];
export type LastLessonRow = EffectiveAttendanceRecord & { status: string };

export function lastAttendedDate(rows: readonly LastLessonRow[], classIds: readonly string[], today: string): string | null {
  let best: string | null = null;
  for (const r of effectiveAttendanceRecords(rows.filter(r => classIds.includes(r.class_id) && r.session_date <= today)))
    if (ATTENDED_STATUSES.includes(r.status) && (!best || r.session_date > best)) best = r.session_date;
  return best;
}

/**
 * 수업일 늦은 순으로 받아 온 줄로 답이 정해졌나 — 다 받았거나(`exhausted`), 답이 된 날보다 **이른** 수업일 줄까지 왔으면
 * 그날과 그 뒤 날짜의 정정 줄이 모두 들어왔다(늦은 순 정렬). 아직 답이 없으면 더 받는다.
 */
export function lastAttendedSettled(rows: readonly LastLessonRow[], classIds: readonly string[], today: string, exhausted: boolean): { date: string | null; settled: boolean } {
  const date = lastAttendedDate(rows, classIds, today);
  if (exhausted) return { date, settled: true };
  const oldest = rows.reduce<string | null>((min, r) => (min === null || r.session_date < min ? r.session_date : min), null);
  return { date, settled: date !== null && oldest !== null && oldest < date };
}

/** 칸 아래 한 줄 — 값이 어디서 왔는지(원장 2026-11-03 *"출결 기준 / 출결 기록 없음 → 오늘"*). */
export type LastLessonSource = "today" | "loading" | "attendance" | "none" | "error" | "manual";
export function lastLessonHint(source: LastLessonSource): string {
  switch (source) {
    case "loading": return "출결에서 마지막 수업일을 찾는 중…";
    case "attendance": return "출결 기준 — 고른 반의 마지막 출석일";
    case "none": return "출결 기록 없음 → 오늘";
    case "error": return "출결을 확인하지 못해 오늘로 두었습니다";
    case "manual": return "직접 입력한 날짜";
    default: return "학생과 반을 고르면 출결에서 채웁니다";
  }
}
