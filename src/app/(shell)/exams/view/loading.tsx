import { PageHeaderSkeleton } from "@/components/page-header";
import { Toolbar, ToolbarSkeletonItem } from "@/components/toolbar";

/**
 * 성적 확인 뷰 스켈레톤 — 한 학기 전건을 읽는 화면이라 첫 페인트를 막지 않는다(B7).
 * 🔑 창(iframe)으로 열면 빈 화면이 특히 오래 보인다 — 실제 표와 같은 껍데기로 자리만 잡아 둔다.
 * 툴바 = 실물 `<Toolbar>` + `ToolbarSkeletonItem`(손으로 그린 `h-8` 줄은 컨트롤 높이·줄 여백이 실물과 달랐다).
 */
export default function Loading() {
  return (
    <div className="flex h-full min-h-0 flex-col space-y-5">
      <PageHeaderSkeleton />
      {/* 툴바 — 보기(통합·입력·확인) · 년도 · 학기 · 과목 · 반. */}
      <Toolbar>
        <ToolbarSkeletonItem className="w-44" />
        <ToolbarSkeletonItem className="w-24" />
        <ToolbarSkeletonItem className="w-24" />
        <ToolbarSkeletonItem className="w-24" />
        <ToolbarSkeletonItem className="w-28" />
      </Toolbar>
      <div className="bg-card shadow-card min-h-[14rem] flex-1 space-y-2 rounded-2xl p-4">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <div key={i} className="bg-bg-soft h-6 w-full animate-pulse rounded" />
        ))}
      </div>
    </div>
  );
}
