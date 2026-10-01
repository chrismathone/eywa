import { PageHeaderSkeleton } from "@/components/page-header";

/**
 * 성적 확인 뷰 스켈레톤 — 한 학기 전건을 읽는 화면이라 첫 페인트를 막지 않는다(B7).
 * 🔑 창(iframe)으로 열면 빈 화면이 특히 오래 보인다 — 실제 표와 같은 껍데기로 자리만 잡아 둔다.
 */
export default function Loading() {
  return (
    <div className="flex h-full min-h-0 flex-col space-y-5">
      <PageHeaderSkeleton />
      <div className="flex flex-wrap gap-3 px-1 py-1">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-line/50 h-8 w-28 animate-pulse rounded-lg" />
        ))}
      </div>
      <div className="bg-card shadow-card min-h-[14rem] flex-1 space-y-2 rounded-2xl p-4">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <div key={i} className="bg-line/40 h-6 w-full animate-pulse rounded" />
        ))}
      </div>
    </div>
  );
}
