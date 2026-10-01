import { PageHeaderSkeleton } from "@/components/page-header";

/**
 * MCS 월간 뷰 스켈레톤(B7) — 툴바 1줄 + 학생 × 수업일 표.
 * 실표면과 같은 라운드·간격이라 데이터가 도착해도 화면이 튀지 않는다(ECS 월간 loading과 같은 규약).
 */
export default function McsMonthLoading() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <PageHeaderSkeleton hideCompact />
      {/* 툴바 스켈레톤 — 실제 툴바는 **카드 껍데기가 없고** 컨트롤 높이는 `--control-h`다(v5 control-scale).
          껍데기를 그리거나 옛 32px로 두면 로딩→본문에서 화면이 튄다(스켈레톤=실표면 동일 캐논). */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-1 py-1">
        <div className="bg-bg-soft h-(--control-h) w-36 shrink-0 animate-pulse rounded-lg" />
        <div className="bg-bg-soft h-(--control-h) w-40 shrink-0 animate-pulse rounded-lg" />
        <div className="bg-bg-soft h-(--control-h) w-28 shrink-0 animate-pulse rounded-lg" />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1.5">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="bg-card shadow-card h-[74px] shrink-0 animate-pulse rounded-[10px]" />
        ))}
      </div>
    </div>
  );
}
