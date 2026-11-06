import { PageHeaderSkeleton } from "@/components/page-header";

/** 미완료 상담 약속 틀 — 약속·대상 이름을 읽는 동안 머리글과 목록 자리를 먼저(B7). */
export default function OpenCareLoading() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeaderSkeleton />
      {[0, 1, 2].map((i) => <div key={i} className="bg-card border-line shadow-card h-20 animate-pulse rounded-2xl border" />)}
    </div>
  );
}
