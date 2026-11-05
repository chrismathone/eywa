import { StatStripSkeleton } from "@/components/atoms/stat-strip";
import { FaceTabsSkeleton } from "@/components/face-tabs-skeleton";
import { PageHeaderSkeleton } from "@/components/page-header";
import { SkeletonLine } from "@/components/skeleton-text";
import { Toolbar, ToolbarSkeletonItem } from "@/components/toolbar";

/** 글자 막대 — 실물 글자 클래스로 줄 높이를 정한다(BigStatSkeleton과 같은 방식). */
const TEXT_BAR = "bg-bg-soft text-transparent animate-pulse rounded";

/**
 * 재고관리 스켈레톤 — 자산 전건 + 건수 4개 + 활성 면을 함께 받으므로 첫 페인트를 막지 않게 즉시 흘려보낸다(B7).
 * 모양 = 실 배치(page.tsx): 헤더(안에 요약 띠 5칸, `stats=`) → 면 탭 → 자산 면(툴바 + 표 카드, `flex-col gap-2`).
 * 주소(`?tab=`)를 못 읽으니 기본 착지인 자산 면으로 그린다. 조치 목록·준비 안 됨 배너는 데이터에 따라 서므로 그리지 않는다.
 */
export default function Loading() {
  return (
    <div className="flex min-h-full w-full flex-col gap-4 p-3 md:px-5 md:py-4">
      {/* 요약 띠는 헤더 안(구분선 위) — StatsRow 5칸, 넷에 보조 줄이 있어 띠 높이는 보조 줄 기준. */}
      <PageHeaderSkeleton stats={<StatStripSkeleton count={5} sub />} />
      {/* 면 탭 — 자산·대여·실사·소모품·업체리스트(업체리스트는 재고관리를 여는 직원 전원에게 보인다). */}
      <FaceTabsSkeleton count={5} />
      <section className="flex flex-col gap-2">
        {/* 툴바 — 검색 · 필터 드롭다운 · 폐기 숨김 · 건수 · (오른쪽) 엑셀 · 인쇄 · 자산 등록. 줄 여백·레일은 실물 Toolbar 그대로. */}
        <Toolbar>
          <ToolbarSkeletonItem className="w-72" />
          <ToolbarSkeletonItem className="w-28" />
          <ToolbarSkeletonItem className="w-20" />
          <SkeletonLine className="w-8 shrink-0 text-xs" />
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <ToolbarSkeletonItem className="w-20" />
            <ToolbarSkeletonItem className="w-16" />
            <ToolbarSkeletonItem className="w-24" />
          </div>
        </Toolbar>
        {/* 자산 표 — 실물 카드 표면(`rounded-2xl p-2`) 하나 안에 머리줄 · 행. 둘 다 실물 칸(th·td `px-2 py-1.5 text-xs`, 약 32px)과
            같은 여백·글자 클래스에 투명 글자를 깔아 줄 높이를 실물 글자가 정한다. */}
        <div className="bg-card shadow-card rounded-2xl p-2">
          <div className="border-line flex border-b px-2 py-1.5 text-xs font-bold">
            <span className={`${TEXT_BAR} w-full`}>자산ID</span>
          </div>
          {Array.from({ length: 10 }, (_, i) => (
            <div key={i} className="border-line-faint flex border-b px-2 py-1.5 text-xs">
              <span className={`${TEXT_BAR} w-full`}>자산 행</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
