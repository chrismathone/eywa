import { PageHeaderSkeleton } from "@/components/page-header";

/**
 * 성적관리 스켈레톤 — 실 화면([`UnifiedDashboard`](./_components/unified-dashboard.tsx)·`/exams/input`)이 PageHeader를 쓰므로
 * 맨 위는 공용 `PageHeaderSkeleton`(같은 한 줄·같은 자리의 '화면 최대화' 버튼). 손으로 쌓은 막대였을 땐 최대화 중 탭·필터를
 * 바꿀 때마다 버튼이 사라져 출구 줄이 섰다 꺼지며 본문이 튀었다(적대 리뷰). 실 머리글처럼 창·모바일에선 접는다(`hideCompact`).
 */
export default function Loading() {
  return <div className="space-y-5 pb-12" aria-busy="true" aria-label="성적관리 불러오는 중">
    <PageHeaderSkeleton hideCompact />
    <div className="bg-bg-soft h-12 animate-pulse rounded-xl" />
    <div className="bg-bg-soft h-52 animate-pulse rounded-xl" />
    <div className="bg-bg-soft h-96 animate-pulse rounded-xl" />
  </div>;
}
