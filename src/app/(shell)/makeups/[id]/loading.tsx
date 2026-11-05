import { PageHeaderSkeleton } from "@/components/page-header";
import { SkeletonLine, SkeletonText } from "@/components/skeleton-text";
import { MakeupBackLinkSkeleton, MakeupFieldSkeleton } from "../_components/makeup-skeleton";

/** 실물 카드 표면(case-records · case-decisions). */
const CARD = "border-line rounded-lg border p-4";
/** 접수 내역 정보 칸(case-records) — 실물 라벨 그대로. */
const INFO = ["학생", "보강 사유", "결석 수업", "자격·진행", "다음 담당·기한"];
const MINUTES = ["목표 분량", "의무 잔량", "예약 중", "예약 가능"];

/**
 * 보강 상세 스켈레톤 — 실 배치(page.tsx → CaseDetailView): 헤더(학생 · 보강, 목록) → 접수 내역 카드 → 결정 카드 격자(lg 2열).
 * 접수 내역은 늘 서는 블록을 전부 그린다(정보 5칸 · 분량 식 · 메모 · 분량 4칸 · 승인 정책 문장 · 연결 근거 목록 · '변경 이력' 접힘 줄, `space-y-4`).
 * 결정 카드·예약·실시 기록은 권한·진행 상태마다 달라 흔한 첫 경우(승인 · 담당 지정 두 장)로 그린다.
 * 목록 스켈레톤(건수 카드·표)을 받으면 모양이 전혀 달라 자기 것을 둔다.
 */
export default function Loading() {
  return (
    <div role="status" aria-label="보강 상세 불러오는 중" className="space-y-4 pb-6">
      <p className="sr-only">보강 건을 불러오고 있습니다…</p>
      <PageHeaderSkeleton actions={<MakeupBackLinkSkeleton />} />
      <section aria-hidden className={`${CARD} space-y-4`}>
        <SkeletonLine className="w-28 font-bold" />
        {/* 정보 5칸 — dt(font-medium) · dd 본문 한 줄씩(24px). */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {INFO.map((label) => (
            <div key={label}>
              <SkeletonText as="div" className="font-medium">
                {label}
              </SkeletonText>
              <SkeletonLine className="w-32" />
            </div>
          ))}
        </div>
        <SkeletonText className="text-sm">목표 00분 + 조정 0분 − 검토 인정 0분 − 면제 0분 = 의무 잔량 00분</SkeletonText>
        <SkeletonLine className="w-40" />
        {/* 분량 4칸 — 실물 `bg-bg-soft rounded-md p-3`: dt 본문 · dd `text-xl font-bold`. */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {MINUTES.map((label) => (
            <div key={label} className="bg-bg-soft animate-pulse rounded-md p-3 text-transparent">
              <div>{label}</div>
              <div className="text-xl font-bold">00분</div>
            </div>
          ))}
        </div>
        <SkeletonText className="text-sm">승인 정책 · 승인 시 고정된 정책 · 적용일 확인 필요</SkeletonText>
        {/* 연결 근거 목록 — 근거 하나(`border-t pt-2`: 종류·연결일 줄 + 접수 당시 출결 줄). */}
        <div className="space-y-2">
          <div className="border-line border-t pt-2">
            <SkeletonText as="div" className="">
              결석 출결 · 연결 2026. 11. 5.
            </SkeletonText>
            <SkeletonText className="">접수 당시 출결 · 결석</SkeletonText>
          </div>
        </div>
        {/* '변경 이력' 접힘 줄(summary `min-h-6 font-medium`) */}
        <SkeletonLine className="w-20 font-medium" />
      </section>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        {[0, 1].map((i) => (
          <section key={i} aria-hidden className={`${CARD} space-y-3`}>
            <SkeletonLine className="w-28 font-bold" />
            <MakeupFieldSkeleton />
            <MakeupFieldSkeleton control="h-22.5" />
            <div className="bg-bg-soft h-(--control-h) w-24 animate-pulse rounded-lg" />
          </section>
        ))}
      </div>
    </div>
  );
}
