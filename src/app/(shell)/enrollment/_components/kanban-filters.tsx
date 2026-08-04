import Link from "next/link";
import { WindowLink } from "@/components/workspace/window-link";
import { BarChart3, LayoutGrid, List } from "@/components/icons/eywa-icon-compat";
import { EyIcon } from "@/components/icons/eywa-icons";
import { FilterSelect } from "@/components/filter-select";
import { SearchForm } from "@/components/search-form";
import { OUTCOME_OPTIONS } from "./outcome-meta";
import { MonthPicker } from "./month-picker";
import { buildEnrollmentQuery, shiftMonth } from "./enrollment-query";
import { RANGE_LABEL, RANGE_PRESETS, type RangePreset } from "@/features/enrollment/range";

type Props = {
  selectedMonth: string | null;
  selectedConsultant: string | null;
  selectedOutcome: string | null;
  searchQuery: string | null;
  view: "kanban" | "table";
  consultants: { id: string; name: string }[];
  /** 적용 중인 기간 프리셋. selectedMonth가 있으면 표시상 해제된다. */
  selectedRange: RangePreset;
  /** 오늘이 속한 달 — 서버에서 계산해 내려받는다(클라에서 new Date()를 쓰면 하이드레이션이 어긋난다). */
  todayMonth: string;
  /** 데이터가 있는 가장 이른 연도 — 연도 이동 하한. */
  minYear: number;
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

  return (
    <div className="bg-card shadow-card flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3">
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

      {/* 뷰 토글 — 칸반 ↔ 목록 */}
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
      </div>

      {/* 이름·전화·학교 검색 — 클라 내비(SearchForm)라 화면 깜빡 없이 결과만 교체(다른 param 자동 보존) */}
      <SearchForm placeholder="이름·전화·학교" defaultValue={searchQuery} />

      <WindowLink
        href="/enrollment/dashboard"
        title="등록상담 대시보드"
        className="text-text-dim hover:text-foreground inline-flex items-center gap-1.5 text-xs"
      >
        <BarChart3 className="size-3.5" />
        대시보드 보기
      </WindowLink>
    </div>
  );
}
