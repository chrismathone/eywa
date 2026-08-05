import type { ReactNode } from "react";
import Link from "next/link";
import { WindowLink } from "@/components/workspace/window-link";
import { BarChart3, LayoutGrid, List } from "@/components/icons/eywa-icon-compat";
import { EyIcon } from "@/components/icons/eywa-icons";
import { FilterSelect } from "@/components/filter-select";
import { SearchForm } from "@/components/search-form";
import { OUTCOME_OPTIONS } from "./outcome-meta";
import { MonthPicker } from "./month-picker";
import { buildEnrollmentQuery, shiftMonth, type EnrollmentView } from "./enrollment-query";
import { RANGE_LABEL, RANGE_PRESETS, type RangePreset } from "@/features/enrollment/range";

type Props = {
  selectedMonth: string | null;
  selectedConsultant: string | null;
  selectedOutcome: string | null;
  searchQuery: string | null;
  view: EnrollmentView;
  consultants: { id: string; name: string }[];
  /** 적용 중인 기간 프리셋. selectedMonth가 있으면 표시상 해제된다. */
  selectedRange: RangePreset;
  /** 오늘이 속한 달 — 서버에서 계산해 내려받는다(클라에서 new Date()를 쓰면 하이드레이션이 어긋난다). */
  todayMonth: string;
  /** 데이터가 있는 가장 이른 연도 — 연도 이동 하한. */
  minYear: number;
  /** makeedu 동기화 배지 — 자기 줄을 쓰지 않게 이 바 오른쪽으로 들여온다. */
  syncBadge?: ReactNode;
  /** 통계뷰 연도 칩 — 이 바에 얹어 sticky로 따라오게 한다(연도를 눌러가며 아래 변화를 보려면 늘 보여야 한다). */
  yearChips?: ReactNode;
};

const buildQuery = buildEnrollmentQuery;

export function KanbanFilters({
  selectedMonth,
  selectedConsultant,
  selectedOutcome,
  searchQuery,
  view,
  consultants,
  selectedRange,
  todayMonth,
  minYear,
  syncBadge,
  yearChips,
}: Props) {
  const displayMonth = selectedMonth ?? todayMonth;
  const base = {
    consultant: selectedConsultant,
    outcome: selectedOutcome,
    q: searchQuery,
    view,
    range: selectedRange,
  };
  const prevMonth = shiftMonth(displayMonth, -1, todayMonth);
  const nextMonth = shiftMonth(displayMonth, 1, todayMonth);

  // 통계뷰는 자기 안에서 연도를 고르고 집계만 본다 — 여기 필터(월·기간·상담사·상태·검색)는
  // 하나도 적용되지 않으므로 **아예 안 그린다**. 눌러도 아무 일이 없는 컨트롤을 남기는 게 더 나쁘다.
  const listFilters = view !== "stats";

  return (
    // 통계뷰는 남는 컨트롤이 뷰 토글뿐이라 여백을 줄이고, **상단에 고정**한다 —
    // 연도를 눌러가며 아래 숫자가 바뀌는 걸 보려면 칩이 스크롤을 따라와야 한다(원장 2026-08-05).
    // ⚠️ sticky는 창(iframe) 안에서도 동작한다(스크롤 컨테이너가 문서라서). 배경이 비치지 않게 불투명 카드.
    <div
      className={`bg-card shadow-card flex flex-wrap items-center gap-3 rounded-2xl px-4 ${
        listFilters ? "py-3" : "sticky top-0 z-20 py-2"
      }`}
    >
      {listFilters ? (
        <>
      {/* 월 navigator */}
      <div className="flex items-center gap-1.5">
        <span className="micro mr-1 shrink-0">월</span>
        <Link
          href={`/enrollment${buildQuery({ ...base, month: prevMonth })}`}
          className="border-line hover:bg-bg-soft inline-flex size-7 items-center justify-center rounded-full border"
          aria-label="이전 달"
        >
          <EyIcon name="chevronLeft" size={14} />
        </Link>
        {/* 라벨 자체가 연·월 피커 트리거 — 화살표만으론 2023년까지 40번 넘게 눌러야 했다. */}
        <MonthPicker
          displayMonth={displayMonth}
          monthFilterActive={!!selectedMonth}
          base={base}
          minYear={minYear}
          todayMonth={todayMonth}
        />
        <Link
          href={`/enrollment${buildQuery({ ...base, month: nextMonth })}`}
          className="border-line hover:bg-bg-soft inline-flex size-7 items-center justify-center rounded-full border"
          aria-label="다음 달"
        >
          <EyIcon name="chevronRight" size={14} />
        </Link>
      </div>

      <span className="bg-line hidden h-4 w-px sm:block" aria-hidden />

      {/* 기간 프리셋 — 🔴 '전체'는 없다(원장 2026-08-04). 이관으로 3년치가 쌓여 전건을 열면
          칸반이 카드 2,197장이 된다. 구간 길이는 최대 1년. 특정 달을 고르면 이 칩은 해제된다. */}
      <div className="flex items-center gap-1.5">
        <span className="micro shrink-0">기간</span>
        <div className="border-line inline-flex items-center gap-0.5 rounded-full border p-0.5">
          {RANGE_PRESETS.map((r) => {
            const active = !selectedMonth && selectedRange === r;
            return (
              <Link
                key={r}
                href={`/enrollment${buildQuery({ ...base, month: null, range: r })}`}
                className={`rounded-full px-2.5 py-1 text-xs transition ${
                  active
                    ? "bg-foreground text-background font-medium"
                    : "text-text-dim hover:text-foreground hover:bg-bg-soft"
                }`}
              >
                {RANGE_LABEL[r]}
              </Link>
            );
          })}
        </div>
      </div>

      <span className="bg-line hidden h-4 w-px sm:block" aria-hidden />

      {/* 상담사 dropdown */}
      <div className="flex items-center gap-2">
        <span className="micro shrink-0">상담사</span>
        <FilterSelect
          paramName="consultant"
          value={selectedConsultant}
          options={consultants.map((c) => ({ value: c.id, label: c.name }))}
          ariaLabel="상담사 필터"
        />
      </div>

      {/* 진행 상태 dropdown (고급 필터) */}
      <div className="flex items-center gap-2">
        <span className="micro shrink-0">상태</span>
        <FilterSelect
          paramName="outcome"
          value={selectedOutcome}
          options={OUTCOME_OPTIONS}
          ariaLabel="진행 상태 필터"
          className="w-32"
        />
      </div>
        </>
      ) : null}

      {yearChips}

      {/* 뷰 토글 — 칸반 · 목록 · 통계 (통계에선 이것과 대시보드 링크만 남는다) */}
      <div className="border-line inline-flex items-center gap-0.5 rounded-full border p-0.5">
        <Link
          href={`/enrollment${buildQuery({ ...base, month: selectedMonth, view: "kanban" })}`}
          aria-label="칸반 보기"
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs transition ${
            view === "kanban"
              ? "bg-foreground text-background font-medium"
              : "text-text-dim hover:text-foreground"
          }`}
        >
          <LayoutGrid className="size-3.5" />
          칸반
        </Link>
        <Link
          href={`/enrollment${buildQuery({ ...base, month: selectedMonth, view: "table" })}`}
          aria-label="목록 보기"
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs transition ${
            view === "table"
              ? "bg-foreground text-background font-medium"
              : "text-text-dim hover:text-foreground"
          }`}
        >
          <List className="size-3.5" />
          목록
        </Link>
        {/* 통계는 집계 화면이라 월·기간·상담사 필터를 안 물려받는다 — 연도만 자기 안에서 고른다. */}
        <Link
          href="/enrollment?view=stats"
          aria-label="통계 보기"
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs transition ${
            view === "stats"
              ? "bg-foreground text-background font-medium"
              : "text-text-dim hover:text-foreground"
          }`}
        >
          <BarChart3 className="size-3.5" />
          통계
        </Link>
      </div>

      {/* 이름·전화·학교 검색 — 클라 내비(SearchForm)라 화면 깜빡 없이 결과만 교체(다른 param 자동 보존) */}
      {listFilters ? <SearchForm placeholder="이름·전화·학교" defaultValue={searchQuery} /> : null}

      {/* 오른쪽 묶음 — 동기화 배지가 자기 줄을 통째로 쓰던 걸 여기로 당겨 한 줄 줄였다(원장 2026-08-05). */}
      <div className="ml-auto flex items-center gap-3">
        <WindowLink
          href="/enrollment/dashboard"
          title="등록상담 대시보드"
          className="text-text-dim hover:text-foreground inline-flex items-center gap-1.5 text-xs"
        >
          <BarChart3 className="size-3.5" />
          대시보드 보기
        </WindowLink>
        {syncBadge}
      </div>
    </div>
  );
}
