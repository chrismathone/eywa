import type { SubjectBillingSummary } from "@/features/dashboard/overview/billing-subject";

/**
 * 그 달에 청구가 있었나 — 과목 관리자 값은 담당 과목 청구서가 0건이어도 과목을 못 가른 청구('과목 모름')가 있으면 청구가 있는 달이다
 * (완납이면 미수 건수가 0이라 금액으로도 본다 — 리뷰 2026-10-20). 수납 통계 카드의 첫 달·다음 달 안내가 한 판정을 쓴다.
 */
export function hasBilling(r: SubjectBillingSummary): boolean {
  return r.totalCount > 0 || (r.unclassified?.count ?? 0) > 0 || (r.unclassified?.billed ?? 0) > 0;
}
