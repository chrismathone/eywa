import { RefundPageSkeleton } from "../_components/refund-page-skeleton";

/** 환불 요청서 보기 스켈레톤 — 수납관리 목록 스켈레톤을 받지 않게 자기 것을 둔다(모양은 `RefundPageSkeleton` 주석). */
export default function RefundViewLoading() {
  return <RefundPageSkeleton editing={false} />;
}
