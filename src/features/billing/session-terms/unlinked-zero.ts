import { isTuitionReceipt } from "./tuition-receipt";
import { receiptMatchesClass } from "./receipt-suggestion";
import type { ReceiptAllocationDraft, ReceiptLine } from "./receipt-allocation";

/**
 * '연결 안 함 = 0원'이 **실수로 빠뜨린 연결**을 덮지 않게 하는 막이 — 화면(저장 버튼)과 서버 액션이 같은 함수를 지난다(#77).
 * 원장 2026-09-17 *"배분 금액이 없으면 0으로 … 연결 안함 처리시 자동으로 0"*의 뜻은 "이 반 몫의 수납이 **없다**"이지
 * "연결을 안 했다"가 아니다(적대적 리뷰 2026-09-17: 제안이 안 붙은 반을 그대로 저장하면 강사 정산이 0이 되고, 그 뒤로는
 * '배분 완료'로 보여 아무도 못 찾는다).
 * - `matchedTerms` — 0원으로 두려는 반인데 이름·반 id가 맞는 수업 수납 항목(금액 > 0)이 있다 → **저장 불가**(그 항목을 이 반에 연결해야 한다).
 * - `unlinkedLines` — 금액이 있는 수업 수납 항목인데 어느 반에도 안 붙었다 → **확인을 받고** 저장한다(`ackUnlinked`). 막지는 않는다 —
 *   특강·모의고사처럼 받을 반이 없는 '수업' 항목이 있는 청구서에서는 막으면 0원을 영영 못 적는다(재리뷰 2026-09-17).
 *   서버 액션·DB(0269a)는 이 경우 확인 표식이 없는 0원 행을 거절한다.
 * 0원으로 두는 반이 없으면 둘 다 빈 배열이다.
 */
export function unlinkedZeroBlockers<T extends { id: string; classId: string | null; className: string | null; confirmedSessions: number | null }>(
  lines: ReceiptLine[],
  terms: T[],
  draft: ReceiptAllocationDraft,
): { unlinkedLines: ReceiptLine[]; matchedTerms: T[] } {
  const lineOf = (term: T) => draft[term.id]?.line ?? "";
  const hasLinks = terms.some((term) => lineOf(term) !== "");
  const zero = hasLinks ? terms.filter((term) => term.confirmedSessions !== null && lineOf(term) === "") : [];
  if (zero.length === 0) return { unlinkedLines: [], matchedTerms: [] };
  const paid = lines.filter((line) => line.amount > 0 && isTuitionReceipt(line.source));
  const used = new Set(terms.map(lineOf).filter((v) => v !== ""));
  return {
    unlinkedLines: paid.filter((line) => !used.has(String(line.index))),
    matchedTerms: zero.filter((term) => paid.some((line) => receiptMatchesClass(line.source, { classId: term.classId, className: term.className }))),
  };
}
