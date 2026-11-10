// 출석부 수정 가능 기간 — 순수 함수(Vitest).
//
// 원장 규칙(2026-07-21): **강사는 7일이 지난 출결을 더 이상 수정할 수 없다. 관리자 이상만 수정 가능.**
// ⚠️ 기준일은 **항상 KST 오늘**(`kstToday()`) — 서버가 UTC라 `new Date()`로 계산하면 한국 새벽 시간대에
//    하루가 밀린다(프로젝트 전역 규칙). 이 모듈은 today를 인자로 받아 순수하게 유지하고, 호출부가 KST를 넘긴다.

import { diffDays } from "@/lib/date-kst";

/** 강사(scoped)가 출결을 고칠 수 있는 기간(일). 세션일 당일 포함 7일. */
export const ATTENDANCE_EDIT_WINDOW_DAYS = 7;

/**
 * 강사가 그 세션 날짜의 출결을 아직 고칠 수 있는가.
 * · 오늘 포함 **7일 이내**면 가능(오늘·어제…6일 전까지). 7일이 지나면(=8일째부터) 잠긴다.
 * · **미래 날짜는 막지 않는다** — 다음 수업을 미리 찍어두는 운영을 차단할 이유가 없다.
 * · 날짜 형식이 이상하면 잠그지 않는다(판정 불가로 기능을 죽이지 않음 — 서버의 다른 검증이 잡는다).
 */
export function isWithinAttendanceEditWindow(sessionDate: string, today: string): boolean {
  const diff = diffDays(sessionDate, today);
  if (Number.isNaN(diff)) return true;
  return diff < ATTENDANCE_EDIT_WINDOW_DAYS;
}

/** 잠긴 이유를 사람 말로 — 화면·서버 응답이 같은 문장을 쓴다(raw 코드 노출 금지 규칙). */
export function attendanceLockMessage(sessionDate: string, today: string): string {
  const diff = diffDays(sessionDate, today);
  const days = Number.isNaN(diff) ? ATTENDANCE_EDIT_WINDOW_DAYS : diff;
  return `${sessionDate} 출결은 ${days}일 지나 강사가 수정할 수 없습니다 (${ATTENDANCE_EDIT_WINDOW_DAYS}일 이내만 가능) — 수정이 필요하면 관리자에게 요청하세요`;
}
