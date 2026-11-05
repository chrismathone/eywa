import { FaceTabsSkeleton } from "@/components/face-tabs-skeleton";
import { PageHeaderSkeleton } from "@/components/page-header";
import { SkeletonLine } from "@/components/skeleton-text";
import { Toolbar, ToolbarSkeletonItem } from "@/components/toolbar";

/** 글자 막대 — 실물 글자 클래스로 줄 높이를 정한다. */
const TEXT_BAR = "bg-bg-soft text-transparent animate-pulse rounded";

/** 라벨 붙은 세그먼트 자리(과목 · 구분) — micro 라벨 + 묶음 상자(높이 = 컨트롤 변수). */
function SegmentSkeleton({ width }: { width: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <SkeletonLine className="micro w-8 shrink-0" />
      <ToolbarSkeletonItem className={width} />
    </div>
  );
}

/**
 * 교재목록 스켈레톤 — 목록·표지 서명 URL·차수 집계를 함께 받으므로 첫 페인트를 막지 않게 즉시 흘려보낸다(B7).
 * 모양 = 실 배치(page.tsx → books-face, 기본 면 '교재' · 기본 과목 영어): 헤더 → 면 탭(교재 · 반 배정) → 툴바 줄(+ 오른쪽 교재 등록) → 표.
 */
export default function Loading() {
  return (
    <div className="flex min-h-full w-full flex-col gap-4 p-3 md:px-5 md:py-4">
      <PageHeaderSkeleton />
      <FaceTabsSkeleton count={2} />
      <div className="flex min-h-0 flex-col gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {/* 툴바 — 검색칸(실물 FIELD `h-8 rounded-lg border` w-44) + 검색 · 엑셀 · 과목 · 구분. 줄 여백·레일은 실물 Toolbar 그대로. */}
          <Toolbar className="min-w-0 flex-1">
            <div className="flex shrink-0 items-center gap-1.5">
              <div className="border-line bg-bg-soft h-8 w-44 animate-pulse rounded-lg border" />
              <ToolbarSkeletonItem className="w-12" />
            </div>
            <ToolbarSkeletonItem className="w-20" />
            <SegmentSkeleton width="w-28" />
            <SegmentSkeleton width="w-64" />
          </Toolbar>
          {/* 교재 등록(쓰기 권한) — 툴바 밖 오른쪽. */}
          <ToolbarSkeletonItem className="w-20" />
        </div>
        <div className="overflow-x-auto px-1">
          {/* 표 머리줄 — 실물 th `py-1.5 text-xs font-bold`(≈ 32px) · `bg-bg-soft` 둥근 띠. 투명 글자로 줄 높이를 실물 글자가 정한다. */}
          <div className="bg-bg-soft text-text-dim flex rounded-md py-1.5 pl-2 text-xs font-bold">
            <span className={TEXT_BAR}>교재</span>
          </div>
          {/* 행 — 표지 썸네일(h-12 w-9) + `py-1.5`. */}
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="border-line-faint flex items-center gap-2 border-b py-1.5 pl-2">
              <div className="border-line-faint bg-bg-soft h-12 w-9 shrink-0 animate-pulse rounded border" />
              <SkeletonLine className="w-48 text-xs font-bold" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
