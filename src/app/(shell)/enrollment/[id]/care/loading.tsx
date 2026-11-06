import { PageHeaderSkeleton } from "@/components/page-header";

/** 등록 전 상담 약속·인계 틀 — 약속·원본 기록을 읽는 동안 머리글과 카드 자리를 먼저(B7). */
export default function IntakeCareLoading() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeaderSkeleton />
      <div className="bg-bg-soft h-5 w-80 max-w-full animate-pulse rounded" />
      <div className="bg-card border-line shadow-card h-64 animate-pulse rounded-2xl border" />
    </div>
  );
}
