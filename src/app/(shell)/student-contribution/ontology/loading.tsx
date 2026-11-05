import { ToolbarSkeletonItem } from "@/components/toolbar";
import { CONTROL_H_SM, CONTROL_LABEL_SM } from "@/components/ui/control-scale";
import { BlockSkeleton, Bar, ContributionHeaderSkeleton } from "../_components/contribution-skeleton";

/**
 * 학생 기록 연결 스켈레톤 — 기본 보기(월별 기여도 근거 · 학원 관점, `OntologyExplorer`)에 맞춘다.
 * `?view=current`(현재 수강 연결)는 본문이 다르지만 loading은 주소를 못 읽는다 — 기본 보기로 타협(원장 결정: 공통 골격).
 * 머리(오른쪽 월 선택) → 보기 전환 두 칸 → 조회 상자(거르기 · 관점 묶음 · 요약 4칸) → xl 2열[기록 종류·학생 근거 | 연결 대상·읽는 법].
 * 아래 2열 상자 높이는 데이터를 따르므로 흔한 값의 근사다.
 */
export default function Loading() {
  return (
    <div role="status" aria-label="학생 기록 연결 불러오는 중" className="w-full min-w-0 space-y-5 pb-6">
      <ContributionHeaderSkeleton
        title="학생 기록 연결"
        description="학생·반·강사·과목별로 같은 달의 기록과 근거를 살펴봅니다."
        actions={<ToolbarSkeletonItem className="w-48" />}
      />
      <div aria-hidden className="flex flex-wrap gap-2">
        {["현재 수강 연결", "월별 기여도 근거"].map((label) => (
          <span key={label} className="border-line rounded-lg border px-4 py-2 text-sm">
            <Bar>{label}</Bar>
          </span>
        ))}
      </div>
      <section aria-hidden className="border-line rounded-xl border">
        {/* 거르기 — 이름 검색 + 상태·학년·과목 + 검색·초기화, 아래 안내 두 줄(실물 `OntologyFilters`). */}
        <div className="border-line border-b p-4">
          {/* 폰 — 거르기 칸은 접히고 요약 한 줄 + '필터 펼치기' 버튼만 선다(데스크톱에선 숨음). */}
          <div className="hidden items-center justify-between gap-2 phone:flex">
            <p className="min-w-0 text-xs">
              <Bar>재원생 · 모든 학년 · 모든 수강 과목</Bar>
            </p>
            <span className="border-line shrink-0 rounded-md border px-2 py-1 text-xs">
              <Bar>필터 펼치기</Bar>
            </span>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-3 phone:hidden">
            <ToolbarSkeletonItem className="min-w-48 flex-1" />
            <ToolbarSkeletonItem className="w-28" />
            <ToolbarSkeletonItem className="w-24" />
            <ToolbarSkeletonItem className="w-24" />
            {/* '검색'·'초기화'는 공용 Button `size="sm"` — 작은 컨트롤 높이·글자에 실물 문구를 투명 글자로. */}
            {["검색", "초기화"].map((label) => (
              <span
                key={label}
                className={`${CONTROL_H_SM} ${CONTROL_LABEL_SM} bg-bg-soft inline-flex shrink-0 animate-pulse items-center rounded-md border border-transparent px-2 font-medium whitespace-nowrap text-transparent`}
              >
                {label}
              </span>
            ))}
            <p className="w-full text-xs">
              <Bar>이름·학교는 입력 후 검색하세요. 선택 조건은 바로 적용됩니다.</Bar>
            </p>
          </div>
          <p className="mt-2 text-xs">
            <Bar>현재 재원 상태·학년 기준 · 과목은 수강 이력 기준 · 모든 관점에 적용</Bar>
          </p>
        </div>
        {/* 관점 묶음(학생·반·강사·과목·학원) + 기준 월 */}
        <div className="border-line flex flex-wrap items-center gap-4 border-b p-4">
          <div className="bg-secondary flex max-w-full gap-1 overflow-x-auto rounded-lg p-1">
            {["학생", "반", "강사", "과목", "학원"].map((label) => (
              <span key={label} className="shrink-0 rounded-md px-4 py-2 text-sm phone:px-3">
                <Bar>{label}</Bar>
              </span>
            ))}
          </div>
          <span className="text-xs">
            <Bar>2026년 1월 기록 기준</Bar>
          </span>
        </div>
        {/* 요약 4칸 — 학원 관점이면 둘째 칸에 '… 중' 한 줄이 더 있다. */}
        <div className="divide-line grid grid-cols-[minmax(0,1.4fr)_1fr_1fr_1.3fr] divide-x phone:grid-cols-2 phone:divide-x-0">
          <div className="bg-primary-softer px-5 py-4">
            <p className="text-xs">
              <Bar>학원 관점</Bar>
            </p>
            <p className="mt-2 text-lg font-bold">
              <Bar>학원 이름</Bar>
            </p>
          </div>
          <div className="px-5 py-4">
            <p className="text-xs">
              <Bar>이 달 기록이 연결된 학생</Bar>
            </p>
            <p className="mt-2 text-xl font-bold">
              <Bar>000명</Bar>
            </p>
            <p className="mt-1 text-xs">
              <Bar>조회 조건에 맞는 000명 중</Bar>
            </p>
          </div>
          {["중복을 뺀 기록", "확인된 수업료"].map((label) => (
            <div key={label} className="px-5 py-4">
              <p className="text-xs">
                <Bar>{label}</Bar>
              </p>
              <p className="mt-2 text-xl font-bold">
                <Bar>000건</Bar>
              </p>
            </div>
          ))}
        </div>
      </section>
      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(22rem,1fr)]">
        <div className="min-w-0 space-y-5">
          {/* 기록 종류 9칸(2열) · 연결된 학생 표(15줄 + 쪽 넘김) */}
          <BlockSkeleton className="h-[25rem]" />
          <BlockSkeleton className="h-[56rem]" />
        </div>
        <div className="space-y-4">
          {/* 연결 대상(8줄 + 쪽 넘김) · '이렇게 읽어 주세요'(테두리 없는 회색 상자) */}
          <BlockSkeleton className="h-[51rem]" />
          <div aria-hidden className="bg-bg-soft h-72 animate-pulse rounded-xl" />
        </div>
      </div>
    </div>
  );
}
