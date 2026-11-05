import { PageHeaderSkeleton } from "@/components/page-header";
import { ToolbarSkeletonItem } from "@/components/toolbar";

/** 글줄 자리 — 투명 글자라 실물과 같은 글자 크기면 같은 줄 높이가 된다. */
const BAR = "bg-bg-soft animate-pulse rounded text-transparent";

/**
 * 출결 모드 스켈레톤 — 폰에서 흰 화면을 보이지 않게(B7). 이 화면은 수업 직후 복도에서 열린다.
 * 실제 표면과 같은 라운드(2xl)·간격이라 로드 후 레이아웃이 튀지 않는다.
 * 순서는 page.tsx·quick-board.tsx와 같다: 머리('나가기') → 요약 글줄 → 반 카드(quick-class-card.tsx).
 */
export default function Loading() {
  return (
    <div className="space-y-4">
      {/* 머리 동작 = '나가기' 단추 하나(공용 `<Button>` 기본 크기 = `--control-h`). */}
      <PageHeaderSkeleton actions={<ToolbarSkeletonItem className="w-16" />} />
      <div aria-hidden className="space-y-2">
        {/* 요약 글줄 — 미입력 · 입력 수(`px-1 text-sm`). */}
        <p className="px-1 text-sm">
          <span className={BAR}>미입력 00명 · 입력 00/00</span>
        </p>
        {Array.from({ length: 3 }).map((_, i) => (
          // 카드 표면 = 실물과 같은 `bg-card shadow-card rounded-2xl px-3 py-2.5`.
          <div key={i} className="bg-card shadow-card rounded-2xl px-3 py-2.5">
            <div className="flex items-center gap-2">
              {/* 접기 단추 — `min-h-11` · 화살표(16px) + 반 이름(`text-base`) / 시각·강의실·입력 수(`text-xs`). */}
              <div className="-mx-1 flex min-h-11 min-w-0 flex-1 items-center gap-1.5 px-1">
                <span className="size-4 shrink-0" />
                <span className="min-w-0">
                  <span className="block text-base font-bold">
                    <span className={BAR}>반 이름</span>
                  </span>
                  <span className="block text-xs">
                    <span className={BAR}>00:00~00:00 · 강의실 · 입력 0/0</span>
                  </span>
                </span>
              </div>
              {/* 일괄 출결 단추 — `min-h-11 rounded-xl`. */}
              <div className="bg-bg-soft min-h-11 w-24 shrink-0 animate-pulse rounded-xl" />
            </div>
            {/* 학생 칩 — `min-h-11 rounded-xl`, 3·4·6열. */}
            <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
              {Array.from({ length: 6 }).map((__, j) => (
                <div key={j} className="bg-bg-soft min-h-11 animate-pulse rounded-xl" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
