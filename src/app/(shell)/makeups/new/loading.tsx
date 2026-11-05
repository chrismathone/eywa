import { PageHeaderSkeleton } from "@/components/page-header";
import { SkeletonLine, SkeletonText } from "@/components/skeleton-text";
import { MakeupBackLinkSkeleton, MakeupFieldSkeleton } from "../_components/makeup-skeleton";

/** 찾기 칸(option-picker — `space-y-2`: 라벨 · 검색칸 + 검색 버튼 줄 · 선택칸). */
function PickerSkeleton({ label }: { label: string }) {
  return (
    <div className="space-y-2">
      <SkeletonLine className={`${label} font-medium`} />
      <div className="flex gap-2">
        <div className="bg-bg-soft h-8 flex-1 animate-pulse rounded-lg" />
        <div className="bg-bg-soft h-(--control-h) w-14 animate-pulse rounded-lg" />
      </div>
      <div className="border-line bg-bg-soft min-h-10 animate-pulse rounded-md border" />
    </div>
  );
}

/**
 * 보강 접수 스켈레톤 — 실 배치(page.tsx → MakeupIntakeForm): 헤더(목록) → 폼 카드(`border-line rounded-lg border p-4`).
 * 폼 = 2열 격자 5칸(과목 · 사유 · 학생 찾기 · 원수업 날짜 · 반 찾기 + 안내 `text-sm` — 기본 사유가 결석이라 늘 선다) → 메모(textarea 3줄 ≈ 90px)
 * → 안내 문장(`text-sm`) → 제출 줄. 목록 스켈레톤(건수 카드·표)을 받으면 모양이 전혀 달라 자기 것을 둔다.
 */
export default function Loading() {
  return (
    <div role="status" aria-label="보강 접수 불러오는 중" className="space-y-4 pb-6">
      <p className="sr-only">보강 접수 화면을 불러오고 있습니다…</p>
      <PageHeaderSkeleton actions={<MakeupBackLinkSkeleton />} />
      <div aria-hidden className="border-line rounded-lg border p-4">
        <div className="space-y-3">
          <div className="grid gap-4 sm:grid-cols-2">
            <MakeupFieldSkeleton label="w-10" />
            <MakeupFieldSkeleton />
            <PickerSkeleton label="w-10" />
            <MakeupFieldSkeleton control="h-8" label="w-24" />
            {/* 반 찾기 + 안내(`text-sm`) */}
            <div className="space-y-1">
              <PickerSkeleton label="w-8" />
              <SkeletonText className="text-sm">학생과 결석일을 먼저 선택해 주세요. 해당 날짜에 수강한 반을 표시합니다.</SkeletonText>
            </div>
          </div>
          <MakeupFieldSkeleton control="h-22.5" label="w-10" />
          <SkeletonText className="text-sm">
            접수 후 담당자가 보강 시간을 승인합니다. 이미 예약한 보강은 ‘기존 보강 예약 연결’에서 연결해 주세요.
          </SkeletonText>
          <div className="bg-bg-soft h-(--control-h) w-24 animate-pulse rounded-lg" />
        </div>
      </div>
    </div>
  );
}
