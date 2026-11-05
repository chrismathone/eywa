import { PageHeaderSkeleton } from "@/components/page-header";
import { ToolbarSkeletonItem } from "@/components/toolbar";

/** 글줄 자리 — 투명 글자라 실물과 같은 글자 크기면 같은 줄 높이가 된다. */
const BAR = "bg-bg-soft animate-pulse rounded text-transparent";

/**
 * 자리 월간 스켈레톤(B7) — 반 14개·학생 88명 조회가 첫 페인트를 막지 않게.
 * 순서는 page.tsx와 같다: 머리 → 요약+범례 카드 **한 장** → 표(남는 높이).
 */
export default function SeatMonthlyLoading() {
  return (
    // 루트 = page.tsx 루트와 같은 클래스(화면 높이에 맞추고 남는 높이를 표가 가져간다).
    <div className="flex h-full min-h-0 flex-col gap-3 pb-3">
      <PageHeaderSkeleton
        actions={
          // page.tsx 머리 동작과 같은 묶음 — 하루 · 출석부로 · 인쇄 · 월 이동(PeriodNav 기본 폭) · 전체 접기.
          <div className="flex flex-wrap items-center gap-1.5">
            <ToolbarSkeletonItem className="w-14" />
            <ToolbarSkeletonItem className="w-22" />
            {/* ⚠️ 인쇄 단추는 실물이 `h-8`이다(print-button.tsx가 공용 크기를 `h-8`로 덮는다) — 머리 줄 높이를 정하는 칸이라 그대로 따른다.
                실물이 `--control-h`로 돌아오면 이 칸도 `ToolbarSkeletonItem`으로 바꿀 것. */}
            <div className="bg-bg-soft h-8 w-12 shrink-0 animate-pulse rounded-lg" />
            <ToolbarSkeletonItem className="w-56" />
            <ToolbarSkeletonItem className="w-24" />
          </div>
        }
      />
      {/* 요약+범례 카드 — page.tsx `bg-card shadow-card shrink-0 space-y-1.5 rounded-2xl px-4 py-2.5`:
          요약 한 줄(`text-sm leading-snug`) + 범례 한 줄(`text-xs`, 색 견본 `size-2.5`). */}
      <div aria-hidden className="bg-card shadow-card shrink-0 space-y-1.5 rounded-2xl px-4 py-2.5">
        <p className="text-sm leading-snug">
          <span className={BAR}>예정 00반 · 000명 │ 확정 000시수 │ 확인 필요 00시수 │ 출석 000 · 결석 00 · 미입력 00</span>
        </p>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {["출석", "결석", "지각", "확인 필요"].map((label) => (
            <span key={label} className={BAR}>
              {/* 색 견본(`size-2.5`) 자리 */}
              <i className="mr-1 inline-block size-2.5 align-middle" />
              {label}
            </span>
          ))}
        </p>
      </div>
      {/* 표 — page.tsx `isolate min-h-0 flex-1` > monthly-table.tsx DragScrollArea `bg-card shadow-card h-full rounded-2xl`. */}
      <div aria-hidden className="isolate min-h-0 flex-1">
        <div className="bg-card shadow-card h-full animate-pulse rounded-2xl" />
      </div>
    </div>
  );
}
