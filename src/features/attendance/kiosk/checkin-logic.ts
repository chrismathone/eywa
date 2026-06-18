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
