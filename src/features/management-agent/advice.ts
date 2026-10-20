import { z } from "zod";
import { CASE_LABEL, RESULT_LABEL, type AgentCase } from "./model";

export const adviceSchema = z.object({
  summary: z.string().trim().min(1).max(400),
  actions: z.array(z.string().trim().min(1).max(200)).min(1).max(3),
  verification: z.string().trim().min(1).max(400),
}).strict();

// Allowlist only: no names, contact details, original counseling text or user-authored notes.
export function adviceFacts(row: AgentCase) {
  return {
    상태: CASE_LABEL[row.status], 후속기한: row.source_due_on,
    접수여부: !!row.acknowledged_at, 담당자지정: !!row.assignee_id,
    완료체크: row.source_done, 처리결과: row.result_kind ? RESULT_LABEL[row.result_kind] : "미기록",
    발생회차: row.episode, 다음확인일: row.next_check_on,
    원본확인시각: row.last_checked_at,
  };
}
export function advicePrompt(row: AgentCase) {
  return [
    "학원 상담 후속조치 담당자를 위한 대응안 JSON을 작성하세요. 제공된 구조화 사실만 사용하세요.",
    "상담 내용, 학생의 의사, 연락 성공, 등록 전환, 실제 문제 해결은 추정하지 마세요.",
    "완료 체크는 결과 검증이 아닙니다. 관리자 확인과 에이와 원본 확인 단계를 제안하세요.",
    "업무 수행·발송·배정·기한 변경은 하지 마세요. actions는 담당자가 검토할 제안입니다.",
    '형식: {"summary":"확인된 상황", "actions":["제안 1~3개"], "verification":"확인할 근거"}. 모든 문장은 한국어.',
    JSON.stringify(adviceFacts(row)),
  ].join("\n");
}
