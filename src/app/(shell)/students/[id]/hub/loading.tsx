import { PageHeaderSkeleton } from "@/components/page-header";
import { CONTROL_H } from "@/components/ui/control-scale";

/** 학생 통합보기 첫 로드 뼈대 — 실물(features/student-hub)과 같은 순서: 머리글(동작 둘) → 구역 이동 줄 → 본문 판. */
export default function Loading() {
  const action = <div className={`bg-bg-soft ${CONTROL_H} w-36 animate-pulse rounded-lg`} />;
  return <div className="space-y-4" aria-busy="true" aria-label="학생 통합보기 불러오는 중">
    <PageHeaderSkeleton actions={<>{action}{action}</>} />
    <div className="bg-bg-soft h-(--control-h-sm) w-[36rem] max-w-full animate-pulse rounded-lg" aria-hidden />
    <div className="bg-card shadow-card h-72 animate-pulse rounded-2xl" aria-hidden />
  </div>;
}
