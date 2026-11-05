import { SkeletonLine, SkeletonText } from "@/components/skeleton-text";

/** 글자 막대 — 실물 문구를 투명하게 깔아 줄 높이를 실물 글자가 정하게 한다. */
const TEXT_BAR = "bg-bg-soft text-transparent animate-pulse rounded";
/** 실물 입력칸(new-meeting-form — `border-input rounded-md border px-3 py-2 text-sm` = 24 + 16 + 2 ≈ 42px). 안에 한 줄 자리. */
const FIELD = "border-input bg-bg-soft animate-pulse rounded-md border px-3 py-2 text-sm";
/** 라벨 — 실물 `block text-sm font-medium`(24px). */
const LABEL = "text-sm font-medium";

/**
 * 새 회의록 스켈레톤 — 실 배치(new/page.tsx): PageHeader 없이 `mx-auto max-w-xl` 한 단 — BackLink → 자체 머리(eyebrow · 제목 text-2xl ·
 * 설명 `text-sm` 긴 문장) → 폼(제목 · 참석자 + '쉼표로 구분' · 일시 · 음성 두 칸 · 메모 4줄 · 제출 줄). 칸 클래스는 실물 그대로라
 * 높이를 실물 글자·여백이 정한다. 목록 스켈레톤(요약 띠·행 표)을 받으면 폭부터 달라 자기 것을 둔다.
 */
export default function Loading() {
  return (
    <div role="status" aria-label="새 회의록 불러오는 중" className="mx-auto max-w-xl space-y-6">
      <p className="sr-only">새 회의록 화면을 불러오고 있습니다…</p>
      {/* BackLink — 실물은 창(iframe) 안에선 그리지 않는다(back-link.tsx). 같은 판정을 창 마커(.embed-main) CSS로 — 줄과 뒤 간격이 함께 빠진다. */}
      <span aria-hidden className="inline-flex items-center gap-1.5 text-sm [.embed-main_&]:hidden">
        <span className={TEXT_BAR}>← 회의록으로</span>
      </span>
      <header aria-hidden className="border-border space-y-1 border-b pb-5">
        <SkeletonLine className="eyebrow w-20" />
        <SkeletonLine className="w-64 max-w-full text-2xl font-bold tracking-tight" />
        <SkeletonText className="text-sm">
          MP3/M4A/WAV 등 음성 파일을 올리면 한국어 전사 후 8개 섹션으로 자동 분석합니다. 브라우저에서 바로 녹음할 수도 있습니다. 다른
          화면으로 이동해도 녹음은 계속되며, 녹음 아이콘에서 진행 상황을 확인할 수 있습니다.
        </SkeletonText>
      </header>
      <div aria-hidden className="space-y-5">
        {/* 회의 제목 */}
        <div className="space-y-1.5">
          <SkeletonLine className={`w-24 ${LABEL}`} />
          <div className={`${FIELD} w-full`}>
            <div className="h-[1lh]" />
          </div>
        </div>
        {/* 참석자 + '쉼표로 구분'(`text-xs`) */}
        <div className="space-y-1.5">
          <SkeletonLine className={`w-14 ${LABEL}`} />
          <div className={`${FIELD} w-full`}>
            <div className="h-[1lh]" />
          </div>
          <SkeletonLine className="w-16 text-xs" />
        </div>
        {/* 회의 일시(w-72) */}
        <div className="space-y-1.5">
          <SkeletonLine className={`w-20 ${LABEL}`} />
          <div className={`${FIELD} w-72`}>
            <div className="h-[1lh]" />
          </div>
        </div>
        {/* 음성 — 파일 업로드 · 바로 녹음 두 칸(실물 점선 상자 `py-5` + 아이콘 20px + `text-sm` · `text-xs` 두 줄 ≈ 118px).
            녹음 라이선스(meeting_recording)가 켜진 기본 경로로 그린다. */}
        <div className="space-y-2">
          <SkeletonLine className={`w-10 ${LABEL}`} />
          <div className="grid grid-cols-2 gap-2">
            {[
              ["파일 업로드", "MP3/M4A/WAV · 100MB"],
              ["바로 녹음", "브라우저 마이크 사용"],
            ].map(([title, sub]) => (
              <div key={title} className="border-border flex flex-col items-center gap-1.5 rounded-md border border-dashed px-3 py-5">
                <span className="bg-bg-soft size-5 animate-pulse rounded" />
                <span className={`${TEXT_BAR} block text-sm font-medium`}>{title}</span>
                <span className={`${TEXT_BAR} text-xs`}>{sub}</span>
              </div>
            ))}
          </div>
        </div>
        {/* 메모장 — textarea `rows=4 text-sm leading-relaxed`(4 × 26 + 여백 ≈ 122px) */}
        <div className="space-y-1.5">
          <SkeletonLine className={`w-14 ${LABEL}`} />
          <div className={`${FIELD} min-h-[6rem] w-full leading-relaxed`}>
            <div className="h-[4lh]" />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t pt-5">
          <div className="bg-bg-soft h-(--control-h) w-28 animate-pulse rounded-lg" />
        </div>
      </div>
    </div>
  );
}
