import type { LaterInvoice, LaterLine, OtherRefundRef } from "@/features/withdrawal-reports/server/refund";
import type { LineDeduction, OpenClaim } from "@/features/withdrawal-reports/refund-decision";

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
  // 미배분 납부가 있는 청구의 0원 줄 — 낸 돈은 미배분 줄에 있다(줄별 기록이 없을 뿐 · '미납'이라 적지 않는다 · 리뷰 r3 R2-m11).
  if (l.paidNet <= 0 && inv.lines.some(x => x.unallocated)) return "줄별 납부 기록 없음";
  return l.paidNet >= net && net > 0 ? "납부" : l.paidNet > 0 ? "일부 납부" : "미납";
}
/** 납부 칸 — 금액 모름 줄은 '—'(청구 전체 미배분액을 그 줄 값처럼 보이지 않는다 · 참고 금액은 줄 설명에 · 리뷰 r3 R2-m11). */
export const paidText = (l: LaterLine) => (l.amountUnknown ? "—" : won(l.paidNet));
/** 미배분 줄 설명(리뷰 r2 I5·D-10) — 과목 몫은 추정 · 청구 전체 미배분액은 참고로만('기타 항목'이라 부르지 않는다). */
export function unallocNote(l: LaterLine, subjectLabel: (k: string) => string): string | null {
  if (!l.unallocated) return null;
  const total = l.unallocTotal != null && (l.amountUnknown || l.unallocTotal !== l.amount) ? ` · 청구 전체 미배분 ${won(l.unallocTotal)}${l.amountUnknown ? "(참고)" : ""}` : "";
  if (!l.unallocScope) return total ? `청구 전체 몫${total}` : null;
  const except = l.unallocScope.startsWith("~");
  const subjects = l.unallocScope.replace(/^~/, "").split(".").map(subjectLabel).join("·");
  return `${except ? `나머지 몫(다른 요청이 정한 ${subjects} 몫 뺌)` : `${subjects} 몫`}${l.amountUnknown ? " · 몫을 계산할 수 없음(환불하지 않음만)" : " · 끝내는 과목 청구액 비율로 내림"}${total}`;
}

const ymd = (at: string) => new Date(at).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
/** 결정 뒤 다시 정할 이 묶음 요청서 줄의 글(리뷰 r2 D-2·D-4 · r3 R2-I2 원장 결정 2026-11-09) — 🔴 완료된 요청서를 비우고 지우라고 안내하지 않는다. */
export function increaseText(re: OpenClaim, completed: boolean, decisionOpen: boolean): string {
  if (re.reason === "inexact") return "줄 내용이 바뀌어 이 요청서가 담았는지 다시 정합니다 — 더 환불하지 않으면 '환불 없음'";
  const inc = re.now - (re.before ?? 0);
  const change = re.before === null ? `+${won(inc)}` : `${won(re.before)} → ${won(re.now)} · +${won(inc)}`;
  if (!decisionOpen) return `${completed ? "환불을 마친 뒤" : "결정 뒤"} 낸 돈이 늘었습니다(${change}) — 늘어난 몫은 수납에서 따로 확인하세요`;
  if (re.separable) return `환불을 마친 뒤 낸 돈이 늘었습니다(${change}) — 이 요청서는 그대로 두고, 늘어난 ${won(inc)}은 수납에서 따로 환불하거나 '환불 없음'으로 정하세요`;
  if (completed) return `환불을 마친 뒤 낸 돈이 늘었습니다(${change}) — 늘어난 몫은 수납에서 따로 확인하세요. 더 환불하지 않으면 '환불 없음'`;
  return `결정 뒤 낸 돈이 늘었습니다(${change}) — 늘어난 몫도 돌려주려면 이 요청서(환불 전)를 지우고 다시 환불 승인, 더 환불하지 않으면 '환불 없음'`;
}
/** 화면용 뺄 몫(결정자 이름은 화면이 붙인다). */
export type LineDeductionView = LineDeduction & { byName?: string | null };
/** 이 요청서가 환불을 마친 줄의 '따로 환불' 기록(데스크가 상세에서 알 수 있게 · 원장 결정 2026-11-09). */
export const separatedText = (d: LineDeductionView) =>
  `늘어난 몫 ${won(d.separate)}은 수납에서 따로 환불하기로 정함${d.separateAt ? ` · ${ymd(d.separateAt)}` : ""}${d.byName ? ` · ${d.byName}` : ""} — 일반 환불 요청서로 처리합니다`;
/** 요청서가 지워진 줄을 다시 정할 때 — 이전 환불 완료 기록·따로 환불을 빼고 요청한다(DB attach 상한과 같은 식 · 리뷰 r3 R2-I2). */
export function deductionText(d: LineDeductionView, remain: number): string {
  const parts = [d.refunded > 0 ? `이전 환불 완료 기록 ${won(d.refunded)}` : null, d.separate > 0 ? `따로 환불 ${won(d.separate)}` : null].filter(Boolean).join(" · ");
  return `${parts} — 다시 승인하면 빼고 ${remain > 0 ? `${won(remain)}만 요청합니다` : "돌려줄 남은 돈이 없습니다(환불하지 않음만)"}`;
}
