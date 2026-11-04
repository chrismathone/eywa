/**
 * 시간표 '수강 종료' 확인 팝업의 **범위 문구** — 순수 모듈(서버·클라 공용, [[#61]] server-only 금지).
 *
 * 원장 2026-09-14 *"퇴원처리가 되지 않도록 하면됨. 1과목이 완전히 종료되면 그 과목에 대해서는 퇴원생 처리하는게
 * 맞음 … 두과목 모두다 퇴원하면 완전한 퇴원."* — 종전 문구 "이 반의 퇴원 목록으로 이동합니다"는 한 반만 끝나는
 * 학생에게도 '퇴원'이라 말했다. 판정은 [`endScopeOf`](@/features/attendance/enrollment-span)(뱃지와 같은 규칙).
 *
 * 🔴 이 저장(`endSingleEnrollment`)은 **그 수강 한 건의 종료일만** 적는다 — 학생 상태(`students.status`)는 안 바뀐다.
 *    그래서 마지막 반이어도 "퇴원 처리됩니다"라고 쓰지 않는다(거짓 약속).
 * 🔴 마지막 반(`student`)은 서버가 종료를 막는다(원장 2026-10-23 퇴원은 퇴원보고서로만 — `lastCourseViaReport`, 판정은 이 문구와 같다).
 *    그 과목의 마지막 반(`subject` + `viaReport`)도 막는다(원장 2026-10-26 — 퇴원관리가 '수강종료'로 세는 것만).
 */
import type { EndScope } from "@/features/attendance/enrollment-span";
import { LAST_COURSE_VIA_REPORT, SUBJECT_END_VIA_REPORT } from "@/features/withdrawals/via-report";

export type EndScopeResult = {
  scope: EndScope;
  /** 계속 다니는 반 이름(`class`=같은 과목 반, `subject`=다른 과목 반). */
  otherClassName: string | null;
  /** `class`일 때 그 반이 **나간 뒤에 이어받은 반**(반이동)인가 — 뱃지 '반이동'·ECS 전출과 같은 판정. */
  transfer: boolean;
  /**
   * 서버가 이 종료를 막고 퇴원보고서로 보내는가(학생의 마지막 반 · 그 과목의 마지막 반 — `viaReportMessage`).
   * ⚠️ 없으면(옛 응답) 종전대로 `student`만 막는 것으로 읽는다.
   */
  viaReport?: boolean;
};

/** 이 판정이 '퇴원보고서로'인가 — 팝업이 빨간 글씨로 막힌다고 말하는 경우. */
export function endScopeViaReport(result: EndScopeResult | null): boolean {
  if (!result) return false;
  return result.viaReport ?? result.scope === "student";
}

/** 서버 판정을 묻는다 — 실패·거절은 null(문구는 게이트가 아니다 · 저장 때 서버가 다시 막는다). */
export async function fetchEndScope(enrollmentId: string, date: string): Promise<EndScopeResult | null> {
  const q = new URLSearchParams({ enrollmentId, date });
  try {
    const response = await fetch(`/api/timetable/end-scope?${q.toString()}`, { cache: "no-store" });
    return response.ok ? ((await response.json()) as { result: EndScopeResult | null }).result : null;
  } catch {
    return null;
  }
}

/** 판정을 못 받았을 때(조회 실패·권한 없음) — 사실만 말한다. */
export const END_SCOPE_UNKNOWN_TEXT = "이 반 수강만 종료합니다. 다른 반 수강은 그대로 유지됩니다.";

export function endScopeText(result: EndScopeResult | null): string {
  if (!result) return END_SCOPE_UNKNOWN_TEXT;
  const other = result.otherClassName;
  switch (result.scope) {
    case "class":
      // 반이동(나간 뒤 14일 안에 같은 과목 반이 시작)은 종강이 아니다 — 월별 출석부 뱃지는 '반이동', ECS는 전출로 본다.
      return result.transfer
        ? `같은 과목 ${other ? `${other} 반` : "다른 반"}으로 옮겨 다닙니다 — 반이동이고, 퇴원이 아닙니다.`
        : `같은 과목 ${other ? `${other} 반` : "다른 반"}은 계속 다닙니다 — 이 반만 종강이고, 퇴원이 아닙니다.`;
    case "subject":
      if (result.viaReport) return SUBJECT_END_VIA_REPORT;
      return `이 과목의 마지막 반입니다 — 이 과목은 수강종료가 됩니다. 다른 과목${other ? `(${other} 반)` : ""}은 계속 다닙니다.`;
    case "student":
      return LAST_COURSE_VIA_REPORT;
  }
}
