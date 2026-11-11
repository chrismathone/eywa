/**
 * 퇴원보고서 작성 차례(s2_0067)의 근거 목록 — 한 줄 = 작성 차례 하나(보완 요청으로 다시 열리면 차례가 하나 더 생긴다).
 * 상태 낱말은 업무 완성도와 같다(기한 내 · 기한 후 완료 · 미처리 · 남음). 순수 함수(서버 · 클라 공용).
 */
export type WithdrawalItem = {
  id: string; reportId: string; turnNo: number; subjects: string[]; studentName: string | null; school: string | null; grade: string | null;
  openedAt: string; dueAt: string; status: "open" | "done"; closedAt: string | null;
};
export type WithdrawalState = "ontime" | "late_done" | "late" | "upcoming" | "early";
export const WITHDRAWAL_STATE_LABEL: Record<WithdrawalState, string> = { ontime: "기한 내", late_done: "기한 후 완료", late: "미처리", upcoming: "남음", early: "완료" };

/** 차례의 상태 — 기한이 아직이면 끝냈어도 '완료'(때가 안 됨 · 판정 밖) · 안 끝냈으면 '남음'. */
export function withdrawalState(it: Pick<WithdrawalItem, "status" | "dueAt" | "closedAt">, nowMs: number): WithdrawalState {
  const due = Date.parse(it.dueAt);
  if (it.status === "done") return due > nowMs ? "early" : it.closedAt && Date.parse(it.closedAt) <= due ? "ontime" : "late_done";
  return due <= nowMs ? "late" : "upcoming";
}
