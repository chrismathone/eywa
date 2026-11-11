import { PageHeaderSkeleton } from "@/components/page-header";
import { SkeletonLine } from "@/components/skeleton-text";

/** 마케팅 입력·검토 첫 로드 뼈대 — 실물과 같은 순서: 머리글 → 시안 표시 띠 → 뒤로 링크(창 안에선 BackLink가 안 서므로 같은 판정을 창 마커 CSS로) → 검토 판 → 설계 판. 부모 화면의 스켈레톤을 물려받지 않게 자기 것(skeleton-pairs 가드 ②). */
export default function Loading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="마케팅 입력 검토 불러오는 중">
      <PageHeaderSkeleton />
      <div className="bg-bg-soft h-9 animate-pulse rounded-lg" aria-hidden />
      <div className="px-1 [.embed-main_&]:hidden" aria-hidden><SkeletonLine className="w-48 text-sm" /></div>
      <div className="bg-card shadow-card h-64 animate-pulse rounded-2xl" aria-hidden />
      <div className="bg-card shadow-card h-48 animate-pulse rounded-2xl" aria-hidden />
    </div>
  );
}
