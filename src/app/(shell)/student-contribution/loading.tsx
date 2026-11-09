import { ToolbarSkeletonItem } from "@/components/toolbar";
import { Bar, ContributionHeaderSkeleton, ScoreBreakdownSkeleton } from "./_components/contribution-skeleton";

/**
 * 원생 충성도 목록 스켈레톤 — 실물 `ContributionList`와 같은 골격.
 * 🔴 옛 것은 `p-4` 안에 막대 둘(`bg-muted`)이라 실물(셸 여백만 · `p-4` 없음)보다 16px 안쪽에서 시작했고, 하위 화면 넷이 이걸 재수출해
 *    모양이 다른 화면에도 같은 막대가 떴다 — 이제 화면마다 자기 스켈레톤을 둔다.
 * 머리 → 요약 띠 → 2xl 2열[학생 목록(기본 접힘) | 22rem 점수 구성] → '점수와 자료 범위 안내'(접힘).
 */
export default function Loading() {
  return (
    <div role="status" aria-label="원생 충성도 불러오는 중" className="w-full min-w-0 space-y-5 pb-6">
      <ContributionHeaderSkeleton
        title="원생 충성도"
        description="학생의 운영 기여와 학습·참여 기록을 모아 봅니다. 학생을 선택하면 점수의 계산 근거를 확인할 수 있습니다."
        actions={<ToolbarSkeletonItem className="w-28" />}
      />
      {/* 요약 띠 — 학생 수·운영·학습·증감 넷 + 오른쪽 집계 일정(흔히 두 줄). */}
      <div
        aria-hidden
        className="border-line flex flex-wrap items-center justify-between gap-4 rounded-xl border px-5 py-4 phone:gap-2 phone:px-4 phone:py-3"
      >
        <div className="flex flex-wrap gap-x-8 gap-y-3 text-sm phone:grid phone:w-full phone:gap-y-1">
          <p>
            <Bar>조회 학생</Bar>
            <strong className="ml-2 text-lg">
              <Bar>000명</Bar>
            </strong>
          </p>
          {["운영 기여", "학습·참여", "최근 1개월 증감"].map((label) => (
            <p key={label}>
              <Bar>{label}</Bar>
              <strong className="ml-2">
                <Bar>000점</Bar>
              </strong>
            </p>
          ))}
        </div>
        <div className="space-y-1 text-xs leading-relaxed">
          <p>
            <Bar>최근 집계 2026. 1. 1. 오전 0:00:00</Bar>
          </p>
          <p>
            <Bar>다음 자동 집계 약 0시간 · 매일 00:00 (한국 시간)</Bar>
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 items-stretch gap-5 2xl:grid-cols-[minmax(0,1fr)_22rem]">
        {/* 학생 목록은 눌러서 연다(10-29) — 기본은 안내 한 줄 + '학생 목록 보기' 버튼. 2xl에선 옆 상자 높이로 늘어난다. */}
        <section
          aria-hidden
          className="border-line bg-card flex min-w-0 flex-col items-center justify-center gap-3 rounded-xl border p-10 text-center"
        >
          <p className="text-sm">
            <Bar>학생별 점수 순위는 눌러서 봅니다.</Bar>
          </p>
          <ToolbarSkeletonItem className="w-44" />
        </section>
        <aside aria-hidden className="border-line bg-card flex min-w-0 flex-col overflow-hidden rounded-xl border">
          <div className="border-line flex items-center justify-between gap-3 border-b px-5 py-4 text-sm">
            <Bar className="font-semibold">조회한 학생의 점수 구성</Bar>
            <Bar>000명</Bar>
          </div>
          <ScoreBreakdownSkeleton contained />
          <p className="border-line border-t px-5 py-3 text-xs leading-relaxed">
            <Bar>검색과 필터에 해당하는 학생 전체의 누적 실적입니다. 페이지를 넘겨도 구성은 같습니다.</Bar>
          </p>
        </aside>
      </div>
      {/* 안내(접힌 details) — 요약 줄 한 줄. */}
      <div aria-hidden className="border-line rounded-xl border p-4 text-xs leading-relaxed">
        <div className="text-sm font-medium">
          <Bar>점수와 자료 범위 안내</Bar>
        </div>
      </div>
    </div>
  );
}
