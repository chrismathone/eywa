import { RefundPageSkeleton } from "../_components/refund-page-skeleton";

/** 환불 요청서 작성 스켈레톤 — 보기와 달리 '학생 자동입력' 상자와 입력칸이 있어 따로 둔다(`RefundPageSkeleton` 주석). */
export default function NewRefundLoading() {
  return <RefundPageSkeleton editing />;
}
