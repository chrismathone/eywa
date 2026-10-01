import { PageHeaderSkeleton } from "@/components/page-header";

/** 시안 첫 페인트(B7) — 실제 운영실 데이터를 읽는 동안 뼈대만 즉시 흘린다. */
export default function DashboardRoleDraftsLoading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <PageHeaderSkeleton />
      <div className="bg-bg-soft h-24 animate-pulse rounded-2xl" />
      <div className="grid grid-cols-4 gap-3">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="bg-bg-soft h-48 animate-pulse rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
