import { PageHeaderSkeleton } from "@/components/page-header";
import { ToolbarSkeletonItem } from "@/components/toolbar";

const BAR = "bg-bg-soft animate-pulse text-transparent rounded";

/**
 * 업무 완성도 스켈레톤 — 창(iframe)으로 열 때 빈 화면을 보이지 않게(B7). 실물(duty-admin.tsx)과 같은 순서:
 * 머리 → 도구 줄(보기 · 기간 · 과목) → 완성도 칸 셋 → 두 단(매트릭스 | 오늘 확인할 것).
 */
export default function Loading() {
  return (
    <div className="space-y-5 compact-chrome:space-y-3" aria-busy="true" aria-label="업무 완성도 불러오는 중">
      <p className="sr-only" role="status">업무 완성도를 불러오고 있습니다…</p>
      <PageHeaderSkeleton />
      <div aria-hidden className="flex flex-wrap items-center gap-2">
        <ToolbarSkeletonItem className="w-56" />
        <ToolbarSkeletonItem className="w-64" />
        <ToolbarSkeletonItem className="w-24" />
      </div>
      <div aria-hidden className="grid gap-2 sm:grid-cols-3">
        {["완성도", "늦은 의무", "원장 단계"].map((l) => (
          <div key={l} className="border-line-faint rounded-xl border px-3 py-2">
            <div className="text-xs font-semibold"><span className={BAR}>{l}</span></div>
            <div className="text-2xl font-bold"><span className={BAR}>00</span></div>
          </div>
        ))}
      </div>
      <div aria-hidden className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(320px,1fr)]">
        <div className="border-line-faint rounded-xl border p-3">
          <div className="grid gap-2">{[0, 1, 2, 3, 4].map((i) => <div key={i} className={`${BAR} h-8`} />)}</div>
        </div>
        <div className="border-line-faint rounded-xl border p-3">
          <div className="grid gap-2">{[0, 1, 2, 3].map((i) => <div key={i} className={`${BAR} h-10`} />)}</div>
        </div>
      </div>
    </div>
  );
}
