import { ToolbarSkeletonItem } from "@/components/toolbar";
import { ContributionHeaderSkeleton } from "../_components/contribution-skeleton";

/**
 * 로열티 랭킹 첫 로드 뼈대 — 실물(loyalty-ranking.tsx)과 같은 순서: 머리글(동작 '최신 기록 집계') + 면 탭 → 상태 줄 → 종합 순위 1~5등 → 항목별 1등 6칸 → 표 판.
 * 2026-11-11 디자인 통일 — 슬로건 판(차콜)을 걷어 그 자리 막대도 뺐다.
 */
export default function RankingLoading() {
  return <div className="space-y-5" role="status" aria-label="학생 로열티 기록을 불러오는 중">
    <ContributionHeaderSkeleton title="학생 로열티 기록실" description="학생 한 명의 기록을 여섯 가지 관점으로. 종합 순위와 항목별 기록을 함께 비교하세요." actions={<ToolbarSkeletonItem className="w-36" />} />
    <div className="bg-bg-soft h-7 animate-pulse rounded" aria-hidden />
    <div className="grid grid-cols-5 gap-3" aria-hidden>{Array.from({ length: 5 }, (_, i) => <div key={i} className="bg-card shadow-card h-24 animate-pulse rounded-2xl" />)}</div>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-6" aria-hidden>{Array.from({ length: 6 }, (_, i) => <div key={i} className="bg-card shadow-card h-36 animate-pulse rounded-2xl" />)}</div>
    <div className="bg-card shadow-card h-80 animate-pulse rounded-2xl" aria-hidden />
  </div>;
}
