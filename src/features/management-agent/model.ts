export const CASE_LABEL = {
  open: "접수 대기",
  in_progress: "처리 중",
  waiting_review: "결과 확인 대기",
  resolved: "조치 확인 완료",
  dismissed: "조치 불필요",
  blocked: "원본 확인 필요",
} as const;
export type CaseStatus = keyof typeof CASE_LABEL;
export const RESULT_LABEL = {
  contacted: "연락·조치 완료",
  retry: "재연락 예정",
  decision: "관리자 판단 필요",
} as const;
export type ResultKind = keyof typeof RESULT_LABEL;
export const EVENT_LABEL: Record<string, string> = {
  detected: "후속조치 감지", acknowledged: "담당자 접수", submitted: "처리 결과 기록",
  verified: "관리자 결과 확인", dismissed: "조치 불필요 확인", reopened: "후속조치 재개",
  source_changed: "원본 변경 확인", source_missing: "원본 확인 필요",
  reminded: "처리 기한 재확인", activated: "담당자 알림 시작", advice: "대응안 작성",
};
export type AgentCase = {
  id: string; tenant_id: string; consultation_id: string; student_id: string;
  assignee_id: string | null; source_counselor_id: string | null; source_due_on: string;
  source_done: boolean; status: CaseStatus; episode: number; version: number;
  result_kind: ResultKind | null; result_note: string | null; verification_note: string | null;
  acknowledged_at: string | null; next_check_on: string | null; last_checked_at: string;
  created_at: string; updated_at: string; ai_advice: AgentAdvice | null; ai_version: number | null;
  studentName?: string | null; assigneeName?: string | null;
};
export type AgentAdvice = { summary: string; actions: string[]; verification: string };
export type CaseEvent = { id: string; kind: string; note: string | null; created_at: string };
export function caseHref(caseId: string): string {
  return `/consultations/followups/${caseId}`;
}
