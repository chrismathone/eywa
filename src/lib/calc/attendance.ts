/**
 * 출석률 % (0~100, 반올림 없이 원값). total<=0이면 0(0-나눗셈 방어).
 * 출석부·수업·상담·대시보드·학생 5곳에 흩어져 각자 구현되던 식을 하나로 통일(#Q3).
 * 표시 자릿수/문자열은 호출부에서 포맷(`.toFixed(1)` 등).
 * ⚠️ 분자는 직접 세지 말고 `attendedCount`/`isAttendedStatus`로 — 무엇을 '출석'으로 치는지가 여기 한 곳이다.
 */
export function attendanceRate(present: number, total: number): number {
  return total > 0 ? (present / total) * 100 : 0;
}

/**
 * **출석률의 분자 = 출석 + 지각** — 원장 2026-09-28 *"지각도 출석으로. 보강은 출석으로 취급하지말것."*
 * 🔴 보강(`makeup`)·조퇴·공결은 분자가 아니다. 분모는 기록된 칸 전부(호출부의 total).
 * 예전엔 화면마다 달랐다: 원생 개요 = 출석만 · 원생 출결 탭 = 출석+지각+보강 · 운영실 도넛 = 출석+지각
 * (매번 지각하는 학생이 개요 0%, 출결 탭 100%). 점검 2026-09-28.
 */
export const ATTENDED_STATUSES: ReadonlySet<string> = new Set(["present", "late"]);

export function isAttendedStatus(status: string): boolean {
  return ATTENDED_STATUSES.has(status);
}

/** 상태별 건수에서 출석률 분자를 낸다. */
export function attendedCount(c: { present: number; late: number }): number {
  return c.present + c.late;
}
