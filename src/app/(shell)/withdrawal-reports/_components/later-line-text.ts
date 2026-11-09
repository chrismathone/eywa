import type { LaterInvoice, LaterLine, OtherRefundRef } from "@/features/withdrawal-reports/server/refund";

/** 퇴원월 뒤 청구 칸(`LaterInvoices`)의 줄 글 — 순수 함수(한 파일 200줄 · 시험이 직접 부른다). */
/**
 * 다른 요청(묶음)의 요청서 표시 — 취소된 요청의 미완료 요청서 · 다른 요청에서 환불 완료 · 다른 요청에서 데스크 환불 대기 · 그 요청서의 담당.
 * 🔴 미완료 = 환불완료일자가 없을 뿐이다(옛 데스크가 이미 돌려줬을 수 있다 — 리뷰 r2 m9) — '환불 전'이라고 단정하지 않고 확인을 먼저 말한다.
 */
export const otherRefundText = (o: OtherRefundRef) => {
  const desk = o.deskName ? ` · 담당 ${o.deskName}` : "";
  // 취소된 요청의 미완료 요청서 — 다시 환불을 승인하면 그 옛 요청서는 완료일자를 넣을 수 없게 DB가 막는다(원장 결정 C.3).
  return o.completed ? `다른 요청에서 환불 완료${desk} · 요청서`
    : o.canceled ? `취소된 요청의 요청서(환불완료일자 없음${desk} — 돌려줬는지 확인한 뒤 다시 승인) · 다시 환불을 승인하면 이 요청서는 완료할 수 없습니다`
    : `다른 요청의 요청서(데스크 환불 대기${desk}) · 요청서`;
};

export const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
export function lineStatus(inv: LaterInvoice, l: LaterLine): string {
  if (inv.status === "refunded" || l.billingRefund) return "수납 환불 기록";
  // makeedu 부분 환불(리뷰 #6) — 남은 돈만 결정 대상 · 금액을 모르면 낸 돈 전부.
  if (l.billingRefundAmount === null) return "수납 부분 환불(금액 모름)";
  if (l.billingRefundAmount) return `수납 부분 환불 ${won(l.billingRefundAmount)}`;
  // 무효(void) 청구인데 낸 돈이 있다(리뷰 r2 (c) — 관문에 든다 · 원장이 환불 승인 또는 환불 없음으로 정한다). 무효 청구 줄을 '미납'으로 적지 않는다.
  if (inv.status === "void") return l.unallocated ? "무효 청구 · 줄별 납부 기록 없음" : l.paidNet > 0 ? "무효 청구 · 낸 돈 있음" : "무효 청구";
  if (l.amountUnknown) return "줄별 납부 기록 없음 · 금액 모름 — 수납에서 확인";
  if (l.unallocated) return l.unallocScope ? "줄별 납부 기록 없음 · 추정 — 수납에서 확인" : "줄별 납부 기록 없음";
  const net = Math.max(0, l.amount - (l.discount ?? 0));
  return l.paidNet >= net && net > 0 ? "납부" : l.paidNet > 0 ? "일부 납부" : "미납";
}
/** 미배분 줄 설명(리뷰 r2 I5·D-10) — 과목 몫은 추정 · 청구 전체 미배분액은 참고로만('기타 항목'이라 부르지 않는다). */
export function unallocNote(l: LaterLine, subjectLabel: (k: string) => string): string | null {
  if (!l.unallocated) return null;
  const total = l.unallocTotal != null && l.unallocTotal !== l.amount ? ` · 청구 전체 미배분 ${won(l.unallocTotal)}` : "";
  if (!l.unallocScope) return total ? `청구 전체 몫${total}` : null;
  const except = l.unallocScope.startsWith("~");
  const subjects = l.unallocScope.replace(/^~/, "").split(".").map(subjectLabel).join("·");
  return `${except ? `나머지 몫(다른 요청이 정한 ${subjects} 몫 뺌)` : `${subjects} 몫`}${l.amountUnknown ? " · 몫을 계산할 수 없음(환불하지 않음만)" : " · 끝내는 과목 청구액 비율로 내림"}${total}`;
}

