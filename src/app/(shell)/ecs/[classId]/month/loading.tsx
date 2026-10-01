import { PageHeaderSkeleton } from "@/components/page-header";

/**
 * ECS 월간 뷰 스켈레톤(B7) — 툴바 1줄 + 목표 스트립 + 주 행 격자.
 * 실표면과 같은 라운드·간격이라 데이터가 도착해도 화면이 튀지 않는다(주간 시트 loading과 같은 규약).
 */
export default function EcsMonthLoading() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <PageHeaderSkeleton hideCompact />
      {/* 상단 바 — 실표면은 **카드 껍데기가 없다**(`SHEET_BAR`, 원장 2026-09-01 "모든 헤더 스타일 일관성") —
          옛 스켈레톤은 `bg-card shadow-card` 띠를 그려 로딩→본문에서 카드가 사라지며 화면이 튀었다.
          높이는 컨트롤과 같은 변수(`--control-h`, v5 control-scale)라 고정 px로 적지 않는다. */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 px-1 py-1">
        <div className="bg-bg-soft h-(--control-h) w-14 shrink-0 animate-pulse rounded-lg" />
        <div className="bg-bg-soft h-(--control-h) w-44 shrink-0 animate-pulse rounded-lg" />
        <div className="bg-bg-soft h-(--control-h) w-40 shrink-0 animate-pulse rounded-lg" />
        <div className="bg-bg-soft h-(--control-h) w-44 shrink-0 animate-pulse rounded-lg" />
      </div>
      <div className="bg-card shadow-card h-[150px] shrink-0 animate-pulse rounded-xl" />
      <div className="grid min-h-0 flex-1 gap-1.5" style={{ gridTemplateColumns: "44px repeat(3, minmax(0, 1fr))" }}>
        {Array.from({ length: 12 }, (_, i) => (
          <div
            key={i}
            className={
              i % 4 === 0
                ? ""
                : "bg-card shadow-card animate-pulse rounded-[10px]"
            }
          />
        ))}
      </div>
    </div>
  );
}
