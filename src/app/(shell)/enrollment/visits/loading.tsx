import { PageHeaderSkeleton } from "@/components/page-header";

/** 방문·등록 점검 — 상담·기록 전건을 읽는 화면이라 뼈대를 먼저 스트리밍한다(B7). */
export default function Loading() {
  return (
    <div className="space-y-4">
      <PageHeaderSkeleton />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="bg-card border-line h-24 animate-pulse rounded-2xl border" />)}
      </div>
      <div className="bg-card border-line h-72 animate-pulse rounded-2xl border" />
    </div>
  );
}
