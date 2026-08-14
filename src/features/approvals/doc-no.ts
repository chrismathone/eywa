/**
 * 문서번호 — `휴가-2026-0001`. 순수 함수(Vitest).
 *
 * 🔑 번호는 **부르는 이름**일 뿐 판정에 쓰지 않는다(문서 식별은 uuid). 그래서 채번이 한 칸 건너뛰거나
 *    동시 기안으로 충돌해도 문서가 깨지지 않는다 — DB `unique(tenant_id, doc_no)`가 중복만 막고,
 *    호출부는 충돌 시 다음 번호로 한 번 더 시도한다.
 * ⚠️ 연도는 **기안 시점 KST 연도**다(서버 UTC로 뽑으면 1월 1일 새벽 문서가 작년 번호를 받는다).
 */

import { APPROVAL_FORM_PREFIX, type ApprovalForm } from "./types";

const SEQ_DIGITS = 4;

export function formatDocNo(form: ApprovalForm, year: number | string, seq: number): string {
  return `${APPROVAL_FORM_PREFIX[form]}-${year}-${String(Math.max(1, seq)).padStart(SEQ_DIGITS, "0")}`;
}

/** 'YYYY-MM-DD'(KST 오늘)에서 연도만. */
export function docYear(today: string): string {
  return today.slice(0, 4);
}

/**
 * 그 해 그 양식의 다음 번호 — 이미 쓴 개수(count)에서 잇는다.
 * `attempt`는 충돌 재시도용(0이면 count+1, 1이면 count+2 …).
 */
export function nextDocNo(
  form: ApprovalForm,
  today: string,
  usedCount: number,
  attempt = 0,
): string {
  return formatDocNo(form, docYear(today), usedCount + 1 + attempt);
}
