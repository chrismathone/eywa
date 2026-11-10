/** 관리 기록(s2_0052 `duty_notes`) — 관리자가 지연·미이행 의무에 남기는 것. 클라·서버 공용(server-only 없음). */
export type DutyNoteAction = "ack" | "reason" | "waive";
export const DUTY_NOTE_ACTIONS: readonly DutyNoteAction[] = ["ack", "reason", "waive"];
export const DUTY_NOTE_LABEL: Record<DutyNoteAction, string> = { ack: "확인", reason: "사유", waive: "면제" };
/** 고를 때 보이는 풀이 — 면제만 숫자를 바꾼다(분모·지연에서 빠진다). */
export const DUTY_NOTE_HINT: Record<DutyNoteAction, string> = {
  ack: "확인만 남깁니다 · 기한 초과는 그대로",
  reason: "기한 초과 사유를 남깁니다 · 기한 초과는 그대로",
  waive: "하지 않아도 되는 업무로 정리합니다 · 집계와 기한 초과에서 제외 · 취소 불가",
};
/** 그 의무의 가장 최근 기록 한 줄. */
export type DutyNote = { action: DutyNoteAction; note: string; by: string; at: string };
export const NOTE_LIMIT = 500;
