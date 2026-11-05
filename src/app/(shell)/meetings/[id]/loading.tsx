import { SkeletonLine, SkeletonText } from "@/components/skeleton-text";

const BAR = "bg-bg-soft animate-pulse rounded";
/** 글자 막대 — 실물 문구를 투명하게 깔아 줄 높이를 실물 글자가 정하게 한다. */
const TEXT_BAR = "bg-bg-soft text-transparent animate-pulse rounded";
/** 실물 카드 표면(메모장 · AI 분석 — `bg-card border-border rounded-2xl border p-5`). */
const CARD = "bg-card border-border rounded-2xl border p-5";

/**
 * 회의록 상세 스켈레톤 — 실 배치([id]/page.tsx): PageHeader 없이 BackLink → 자체 머리(날짜 · 상태 알약 → 제목 text-3xl → 시간·참석자
 * `text-sm` 줄 | 오른쪽 버튼 둘) → 메모장 카드(textarea 6줄 `text-sm leading-relaxed` ≈ 174px + '메모 저장') → AI 분석 카드.
 * 목록 스켈레톤(요약 띠·행 표)을 받으면 모양이 전혀 달라 자기 것을 둔다. 처리 중·실패 카드는 상태에 따라 서므로 흔한 경우(완료)로 그린다.
 */
export default function Loading() {
  return (
    <div role="status" aria-label="회의록 불러오는 중" className="space-y-6">
      <p className="sr-only">회의록을 불러오고 있습니다…</p>
      {/* BackLink — 실물은 창(iframe) 안에선 그리지 않는다(back-link.tsx). 같은 판정을 창 마커(.embed-main) CSS로 — 줄과 뒤 간격이 함께 빠진다. */}
      <span aria-hidden className="inline-flex items-center gap-1.5 text-sm [.embed-main_&]:hidden">
        <span className={TEXT_BAR}>← 회의록으로</span>
      </span>
      <header aria-hidden className="border-border flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          {/* 날짜(eyebrow) + 상태 알약(Pill sm — `px-2.5 py-[3px] text-xs` ≈ 26px) */}
          <div className="flex items-center gap-2">
            <SkeletonLine className="eyebrow w-28" />
            <span className={`${TEXT_BAR} rounded-pill inline-flex px-2.5 py-0.75 text-xs font-bold`}>완료</span>
          </div>
          <SkeletonLine className="w-72 max-w-full text-3xl font-bold" />
          <SkeletonText className="text-sm">00:00 · 0명 · 참석자 이름 · 작성 작성자</SkeletonText>
        </div>
        {/* AI로 정리(Primary) · 더보기 */}
        <div className="flex shrink-0 items-center gap-2">
          <div className="bg-bg-soft h-(--control-h) w-24 animate-pulse rounded-lg" />
          <div className="bg-bg-soft h-(--control-h) w-16 animate-pulse rounded-lg" />
        </div>
      </header>
      {/* 메모장 — 머리(`text-sm font-bold`) + textarea(실물 클래스 · 6줄 = `h-[6lh]`) + '메모 저장'(`px-3 py-1.5 text-xs`). */}
      <section aria-hidden className={`${CARD} space-y-3`}>
        <SkeletonLine className="w-16 text-sm font-bold" />
        <div className="space-y-2">
          <div className="border-input bg-bg-soft min-h-[9rem] w-full animate-pulse rounded-md border px-3 py-2 text-sm leading-relaxed">
            <div className="h-[6lh]" />
          </div>
          <div className="flex items-center justify-end gap-2">
            <span className={`${TEXT_BAR} inline-flex rounded-lg px-3 py-1.5 text-xs font-bold`}>□ 메모 저장</span>
          </div>
        </div>
      </section>
      {/* AI 분석 — 머리(`text-sm font-bold` · 생성 시각 `text-xs`) + 섹션 아코디언(테두리 상자 여럿). */}
      <section aria-hidden className={`${CARD} space-y-5`}>
        <div className="flex items-start justify-between gap-3">
          <SkeletonLine className="w-20 text-sm font-bold" />
          <SkeletonLine className="w-24 text-xs" />
        </div>
        <div className="space-y-2">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className={`border-line h-11 rounded-md border ${BAR}`} />
          ))}
        </div>
      </section>
    </div>
  );
}
