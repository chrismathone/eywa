/**
 * 퇴원보고서 상세 맨 위 한 줄(`[id]/page.tsx` — 상태 없는 표시 부품이라 서버 화면에서 그린다 · 사진·시험이 같은 부품을 그린다).
 * - `decision` = 원장 환불 결정 차례(리뷰 r2 m8 — 결정 자리 `#refund`로).
 * - `recheck` = 목록은 '환불 결정 대기'인데 지금 계산엔 이 보고서에 정할 건이 없다(리뷰 r3 R2-I1 — '열람 — 승인자로 지정되지 않았습니다' 대신 그 사실과 다시 판정 자리).
 * - `view` = 승인자·요청자·작성자가 아닌 열람(원장 2026-10-30 "요청서 승인이 없어도 '열람'형식으로").
 */
export type ReportBannerKind = "decision" | "recheck" | "view" | null;

export function ReportPageBanner({ kind }: { kind: ReportBannerKind }) {
  if (kind === "decision") return <p className="rounded-lg border px-3 py-2 text-sm">원장 환불 결정 차례 — 아래 &apos;환불 확인&apos;에서 환불 승인 또는 환불 없음을 정하세요. <a href="#refund" className="text-primary hover:underline">환불 확인으로 가기</a></p>;
  if (kind === "recheck") return <p className="rounded-lg border px-3 py-2 text-sm">원장 환불 결정 대기 — 목록 표시와 다릅니다. 지금 계산으로는 이 보고서에 정할 건이 없습니다. 아래 &apos;환불 확인&apos;에서 지금 다시 판정하세요. <a href="#refund" className="text-primary hover:underline">환불 확인으로 가기</a></p>;
  if (kind === "view") return <p className="border-line text-muted-foreground rounded-lg border border-dashed px-3 py-2 text-sm">열람 — 이 보고서의 승인자로 지정되지 않았습니다. 승인은 지정된 사람만 할 수 있습니다.</p>;
  return null;
}
