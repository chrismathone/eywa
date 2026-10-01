import { PageHeaderSkeleton } from "@/components/page-header";

/**
 * ECS 랜딩 스켈레톤(B7) — 실표면과 동일 라운드(rounded-2xl)·**한 장 시트** 정합.
 * 2026-08-11 랜딩이 카드 그리드에서 단일 패널 목록으로 바뀌어 스켈레톤도 같이 옮겼다
 * (스켈레톤이 옛 모양이면 로딩→본문에서 레이아웃이 통째로 튄다).
 */
export default function EcsLandingLoading() {
  return (
    <div className="space-y-4">
      <PageHeaderSkeleton />
      {/* 면 탭(주간/오늘) — 실화면은 헤더 바로 아래 `EcsFaceTabs` 한 줄이다. */}
      <div className="bg-bg-soft h-(--control-h) w-40 animate-pulse rounded-lg" />
      {/* 툴바 스켈레톤 — 실제 툴바는 카드 껍데기가 없고 컨트롤 높이는 `--control-h`다(v5 control-scale;
          09-01 "h-(--control-h) 고정" 캐논을 대체). 옛 32px로 두면 로딩→본문에서 툴바 줄이 6px씩 줄며 본문이 튄다. */}
      <div className="flex flex-wrap items-center gap-3 px-1 py-1">
        <div className="bg-bg-soft h-(--control-h) w-40 animate-pulse rounded-lg" />
        <div className="bg-bg-soft h-(--control-h) w-44 animate-pulse rounded-lg" />
        <div className="bg-bg-soft h-(--control-h) w-36 animate-pulse rounded-lg" />
      </div>
      <div className="bg-card shadow-card rounded-2xl px-3 py-2.5">
        <div className="border-line border-b px-1 pb-2">
          <div className="bg-bg-soft h-4 w-64 animate-pulse rounded" />
        </div>
        {/* 본문은 담임 묶음이 다단으로 흐른다 — 스켈레톤도 같은 골격이라야 로딩→본문에서 안 튄다. */}
        <div className="columns-1 gap-x-5 sm:columns-2 lg:columns-3">
          {Array.from({ length: 6 }).map((_, g) => (
            <div key={g} className="mb-3 break-inside-avoid">
              <div className="border-line-strong border-b px-1 pb-0.5">
                <div className="bg-bg-soft h-4 w-24 animate-pulse rounded" />
              </div>
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="border-line-faint flex items-center gap-2 border-b px-1.5 py-[7px]">
                  <div className="bg-bg-soft h-4 flex-1 animate-pulse rounded" />
                  <div className="bg-bg-soft h-4 w-11 shrink-0 animate-pulse rounded" />
                  <div className="bg-bg-soft h-1.5 w-10 shrink-0 animate-pulse rounded-full" />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
