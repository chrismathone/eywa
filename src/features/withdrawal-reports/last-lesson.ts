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

/**
 * 칸 아래 한 줄 — 값이 어디서 왔는지(원장 2026-11-03 *"출결 기준 / 출결 기록 없음 → 오늘"*).
 * 출결에서 날짜를 얻지 못한 경우(`lastLessonNeedsCheck`)는 눈에 띄는 알림으로, 까닭(기록 없음 · 고른 반 없음 · 권한 없음 · 오류)마다 다른 글로
 * 알린다(원장 2026-11-05 *"마지막 출결일이 조회되지 않으면 조회되지않는다는 알림문구도 같이."*).
 */
export type LastLessonSource = "today" | "loading" | "attendance" | "none" | "nocourses" | "unselected" | "denied" | "error" | "manual";
/**
 * `nocourses` = 다니는 반이 없는 원생(바로 처리 — 경고) · `unselected` = 반이 있는데 지금 하나도 고르지 않음(흐린 안내 — 고르면 출결을 찾는다).
 * 훅은 고른 반이 없으면 `nocourses`를 주고, 창이 원생에게 반이 있으면 `unselected`로 바꿔 보인다(리뷰 2026-11-06).
 * `kept` = '출결에서 다시 불러오기'가 날짜를 얻지 못해 칸의 날짜를 그대로 둔 상태 — '(지금은 오늘 날짜)'가 아니다(이 날짜가 곧 수강 종료일).
 */
export function lastLessonHint(source: LastLessonSource, kept = false): string {
  if (kept && source === "none") return "고른 반에서 출석 기록을 찾지 못해 마지막 수업일 칸의 날짜를 그대로 두었습니다 — 직접 확인해 주세요.";
  if (kept && source === "denied") return "출결을 볼 권한이 없어 마지막 수업일 칸의 날짜를 그대로 두었습니다 — 직접 확인해 주세요.";
  if (kept && source === "error") return "출결을 불러오지 못해 마지막 수업일 칸의 날짜를 그대로 두었습니다 — 다시 불러오거나 직접 확인해 주세요.";
  switch (source) {
    case "loading": return "출결에서 마지막 수업일을 찾는 중…";
    case "attendance": return "출결 기준 — 고른 반의 마지막 출석일";
    case "none": return "고른 반에서 출석 기록을 찾지 못했습니다 — 마지막 수업일을 직접 확인해 입력해 주세요(지금은 오늘 날짜).";
    case "nocourses": return "다니는 반이 없어 출결에서 찾을 수 없습니다 — 마지막 수업일을 직접 확인해 입력해 주세요(지금은 오늘 날짜).";
    case "unselected": return "종료할 반을 고르면 출결에서 찾습니다";
    case "denied": return "출결을 볼 권한이 없어 마지막 수업일을 찾지 못했습니다 — 직접 확인해 입력해 주세요(지금은 오늘 날짜).";
    case "error": return "출결을 불러오지 못했습니다 — ‘출결에서 다시 불러오기’를 누르거나 마지막 수업일을 직접 입력해 주세요(지금은 오늘 날짜).";
    case "manual": return "직접 입력한 날짜";
    default: return "학생과 반을 고르면 출결에서 채웁니다";
  }
}
/** 출결에서 마지막 수업일을 얻지 못한 상태인가 — 알림으로 보인다(반을 고르는 중인 `unselected`는 흐린 안내). */
export function lastLessonNeedsCheck(source: LastLessonSource): boolean {
  return source === "none" || source === "nocourses" || source === "denied" || source === "error";
}
/**
 * '출결에서 다시 불러오기' 단추를 보일 때 — 손으로 고쳤거나 오류였을 때(다시 부르는 중엔 보이되 꺼 둔다).
 * 출결 권한이 없다는 답을 한 번이라도 받았으면(`denied`) 숨긴다 — 눌러도 찾을 수 없다(리뷰 2026-11-06).
 */
export function lastLessonReloadable(source: LastLessonSource, reloading = false, denied = false): boolean {
  if (denied) return false;
  return source === "manual" || source === "error" || (source === "loading" && reloading);
}
