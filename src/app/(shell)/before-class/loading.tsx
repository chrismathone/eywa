import { PageHeaderSkeleton } from "@/components/page-header";

export default function Loading() {
  return (
    <div className="space-y-4" role="status" aria-label="비포클래스체크리스트 불러오는 중">
      <PageHeaderSkeleton />
      <div className="bg-muted h-10 animate-pulse rounded-2xl" />
      <div className="bg-muted h-80 animate-pulse rounded-2xl" />
    </div>
  );
}
