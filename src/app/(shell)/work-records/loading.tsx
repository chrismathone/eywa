import { PageHeaderSkeleton } from "@/components/page-header";

/** 업무 작성센터 첫 로드 뼈대 — 기록 조회를 기다리는 동안 빈 화면 대신(B7). 실물 순서: 머리글 → 기록 바로가기 판 → 서식 판 → 작성·확인 현황 판. */
export default function Loading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="업무 작성센터 불러오는 중">
      <PageHeaderSkeleton />
      <div className="bg-card shadow-card h-64 animate-pulse rounded-2xl" aria-hidden />
      <div className="bg-card shadow-card h-40 animate-pulse rounded-2xl" aria-hidden />
      <div className="bg-card shadow-card h-48 animate-pulse rounded-2xl" aria-hidden />
    </div>
  );
}
