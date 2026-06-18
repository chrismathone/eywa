// 등하원 자동판단 — 순수함수. 그날 학생의 등하원 레코드 상태로 다음 동작을 결정.
// 정책(사용자 확정): 그날 첫 입력=등원, 둘째 입력=하원, 그 뒤=noop(이미 완료).

export type CheckinAction = "check_in" | "check_out" | "noop";

export type ExistingCheckin = {
  checkedInAt: string | null;
  checkedOutAt: string | null;
} | null;

/** 오늘 등하원 레코드 상태 → 다음 동작. */
export function decideCheckinAction(existing: ExistingCheckin): CheckinAction {
  if (!existing || !existing.checkedInAt) return "check_in";
  if (!existing.checkedOutAt) return "check_out";
  return "noop";
}

// ── 출석부 연동: 등원 시각이 어느 수업 시간에 해당하는지 ──────────────────────
// "HH:MM" 또는 "HH:MM:SS" → 자정 기준 분. 파싱 불가 토막은 0 처리.
export function timeToMinutes(t: string): number {
  const [h, m] = String(t).split(":");
  return (Number(h) || 0) * 60 + (Number(m) || 0);
}

/**
 * 현재 시각(nowMin)이 들어가는 오늘 수업들의 classId. 등원은 수업 시작 전 도착도 인정하므로
 * 시작 graceBeforeMin(기본 30분) 전부터 종료 시각까지를 창으로 본다.
 * 호출부는 결과가 정확히 1개일 때만 출석부에 반영(0/다중은 모호 → 스킵).
 */
export function classesInWindow(
  schedules: { classId: string; startMin: number; endMin: number }[],
  nowMin: number,
  graceBeforeMin = 30,
): string[] {
  return schedules
    .filter((s) => nowMin >= s.startMin - graceBeforeMin && nowMin <= s.endMin)
    .map((s) => s.classId);
}
