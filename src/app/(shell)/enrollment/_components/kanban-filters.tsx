import type { ReactNode } from "react";
import Link from "next/link";
import { BarChart3, LayoutGrid, List } from "@/components/icons/eywa-icon-compat";
import { FilterSelect } from "@/components/filter-select";
import { PeriodNav } from "@/components/period-nav";
import { SearchForm } from "@/components/search-form";
import { BOARD_STAGE_OPTIONS, type BoardStageKey } from "@/features/enrollment/board-stages";
import { MonthPicker } from "./month-picker";
import {
  buildEnrollmentQuery,
  enrollmentHref,
  formatMonthLabel,
  shiftMonth,
  type EnrollmentView,
} from "./enrollment-query";
import { RANGE_LABEL, RANGE_PRESETS, type RangePreset } from "@/features/enrollment/range";

type Props = {
  selectedMonth: string | null;
  selectedConsultant: string | null;
  /** 진행 단계(칸반 4칸) 필터 — 옛 raw outcome 7종이 아니다(원장 2026-09-01). */
  selectedStage: BoardStageKey | null;
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
  /**
   * 헤더에 있던 숫자(전체·AI 분석 완료·배정 완료). 🔴 검색창 **바로 왼쪽**에 선다
   * (원장 2026-09-01 *"멘트 제거하고 숫자는 검색창 왼쪽으로 이동"*) — 헤더에서 한 줄을 통째로
   * 쓰던 것을 툴바로 접어 화면 높이를 벌었다.
   */
  stats?: ReactNode;
  /** 통계뷰 연도 칩 — 이 바에 얹어 sticky로 따라오게 한다(연도를 눌러가며 아래 변화를 보려면 늘 보여야 한다). */
  yearChips?: ReactNode;
};

const buildQuery = buildEnrollmentQuery;

/**
 * 툴바 드롭다운 트리거 — 높이만 공용 Button(h-8)에 맞추고 톤은 SearchableSelect 기본과 같게 다시 적는다.
 * ⚠️ `triggerClassName`은 톤까지 통째로 대체하므로 **반쪽만 적으면 색이 갈린다**(그 컴포넌트 주석).
 */
const TOOLBAR_SELECT = "border-border bg-card text-foreground flex h-8 items-center rounded-md border px-3 text-sm";

/**
 * 🔴 툴바 라운드는 **덜 둥근 쪽으로 통일**한다(원장 2026-09-01: *"버튼 라운드 통일"* →
 * *"라운드 덜진쪽으로 통일"*): 묶음 상자 `rounded-lg`, 그 안의 칩·링크 `rounded-md`.
 * 종전엔 알약(`rounded-full`) 묶음과 각진 기간 네비·버튼이 한 줄에 섞여 있었다.
 * ⚠️ 디자인 캐논의 "칩 = full"은 **본문 배지**에 대한 규칙이다 — 컨트롤이 늘어선 툴바는 버튼·입력과
 *    같은 계열로 본다(캐논: 버튼/인풋 = lg).
 */

export function KanbanFilters({
  selectedMonth,
  selectedConsultant,
  selectedStage,
  searchQuery,
  view,
  consultants,
  selectedRange,
  todayMonth,
  minYear,
  syncBadge,
  yearChips,
  stats,
}: Props) {
  const displayMonth = selectedMonth ?? todayMonth;
  const base = {
    consultant: selectedConsultant,
    outcome: selectedStage,
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
    // 🔴 툴바를 감싸던 카드 테두리를 뺐다(원장 2026-09-01 *"헤더 감싸고 있는 테두리 제거"*) —
    // 아래 칸반 네 칸이 각자 테두리를 갖게 되면서 선이 이중으로 겹쳐 보였다. 컨트롤 자체가 이미
    // 테두리를 갖고 있어 줄은 그대로 읽힌다.
    // ⚠️ 통계뷰에선 이 바가 sticky다 — 배경이 없으면 스크롤 내용이 비치므로 그때만 불투명 배경.
    <div
      className={`flex flex-wrap items-center gap-2.5 px-1 ${
        listFilters ? "py-1" : "bg-background sticky top-0 z-20 py-2"
      }`}
    >
      {listFilters ? (
        <>
      {/* 월 이동 — 앱 전역 단일 소스 [PeriodNav](@/components/period-nav)(원장 2026-09-01
          *"이거 월간이동. 다른 곳과 통일시켜. ecs 살펴볼것"*). 시간표·ECS·출석부·수납·캘린더와 같은
          `‹ 2026년 9월 ›` 한 덩어리다.
          🔴 '이번 달' 버튼은 따로 두지 않는다 — 가운데 라벨을 누르면 이번 달로 오고, 다른 달을 보는
             중이면 **과거/미래 조회 배지**가 그 사실을 말한다(PeriodNav 규약).
          ⚠️ 연·월 **직접 선택**(달력 아이콘)은 PeriodNav 밖에 그대로 남는다 — 화살표만으론 2023년까지
             40번 넘게 눌러야 한다(ECS 오늘 면의 날짜 선택과 같은 배치). */}
      <div className="flex items-center gap-1.5">
        <PeriodNav
          label={formatMonthLabel(displayMonth)}
          prevHref={enrollmentHref({ ...base, month: prevMonth })}
          nextHref={enrollmentHref({ ...base, month: nextMonth })}
          currentHref={enrollmentHref({ ...base, month: todayMonth })}
          relation={
            displayMonth === todayMonth ? "current" : displayMonth < todayMonth ? "past" : "future"
          }
          prevAriaLabel="이전 달"
          nextAriaLabel="다음 달"
          currentTitle="눌러서 이번 달로"
          // "2026년 12월"까지 안 넘치는 고정 폭 — ECS 월간 뷰와 같은 값(같은 라벨 모양이라 같이 선다).
          labelWidth={116}
        />
        <MonthPicker
          displayMonth={displayMonth}
          monthFilterActive={!!selectedMonth}
          base={base}
          minYear={minYear}
          todayMonth={todayMonth}
        />
      </div>

      <span className="bg-line hidden h-4 w-px sm:block" aria-hidden />

      {/* 기간 프리셋 — 🔴 '전체'는 없다(원장 2026-08-04). 이관으로 3년치가 쌓여 전건을 열면
          칸반이 카드 2,197장이 된다. 구간 길이는 최대 1년. 특정 달을 고르면 이 칩은 해제된다. */}
      <div className="flex items-center gap-1.5">
        <span className="micro shrink-0">기간</span>
        {/* 높이 h-8 = 공용 Button 기본 크기(툴바 한 줄 정렬). */}
        <div className="border-line inline-flex h-8 items-center gap-0.5 rounded-lg border p-0.5">
          {RANGE_PRESETS.map((r) => {
            const active = !selectedMonth && selectedRange === r;
            return (
              <Link
                key={r}
                href={`/enrollment${buildQuery({ ...base, month: null, range: r })}`}
                className={`rounded-md px-2.5 py-1 text-xs transition ${
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
          triggerClassName={TOOLBAR_SELECT}
        />
      </div>

      {/* 진행 상태 dropdown — 🔴 **칸반과 같은 4단계**(원장 2026-09-01 *"상태 드랍다운도 4단계로
          통일해야지"*). 선택지는 board-stages 단일 소스라 칸 이름과 절대 갈리지 않는다.
          ⚠️ 파라미터 이름은 `outcome` 그대로고 값만 칸 키다(옛 링크는 그 칸으로 넓혀 받는다). */}
      <div className="flex items-center gap-2">
        <span className="micro shrink-0">상태</span>
        <FilterSelect
          paramName="outcome"
          value={selectedStage}
          options={BOARD_STAGE_OPTIONS}
          ariaLabel="진행 단계 필터"
          className="w-32"
          triggerClassName={TOOLBAR_SELECT}
        />
      </div>
        </>
      ) : null}

      {yearChips}

      {/* 뷰 토글 — 칸반 · 목록 · 통계 (통계에선 이것과 대시보드 링크만 남는다) */}
      <div className="border-line inline-flex h-8 items-center gap-0.5 rounded-lg border p-0.5">
        <Link
          href={`/enrollment${buildQuery({ ...base, month: selectedMonth, view: "kanban" })}`}
          aria-label="칸반 보기"
          className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs transition ${
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
          className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs transition ${
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
          className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs transition ${
            view === "stats"
              ? "bg-foreground text-background font-medium"
              : "text-text-dim hover:text-foreground"
          }`}
        >
          <BarChart3 className="size-3.5" />
          통계
        </Link>
      </div>

      {/* 오른쪽 묶음 — 동기화 배지가 자기 줄을 통째로 쓰던 걸 여기로 당겨 한 줄 줄였다(원장 2026-08-05).
          🔴 '대시보드 보기' 링크는 **뺐다**(원장 2026-09-01 *"대시보드 보기는 일단 제거해. 통계뷰가
          있으니까"*) — 바로 옆 뷰 토글의 '통계'와 같은 일을 하는 두 번째 입구였다. 라우트
          (`/enrollment/dashboard`)는 살아 있으니 되살릴 땐 이 자리에 링크만 다시 놓으면 된다. */}
      <div className="ml-auto flex items-center gap-3">
        {/* 동기화 시각 표시만 남는다 — '지금 동기화' 버튼은 없앴다(주간 자동, 손으로 돌릴 일은 연동 면). */}
        {syncBadge}
        {stats}
        {/* 🔴 검색은 **맨 오른쪽**(원장 2026-09-01 *"검색창 최우측으로"*). 이름·전화·학교 검색은
            클라 내비(SearchForm)라 화면 깜빡 없이 결과만 교체된다(다른 param 자동 보존). */}
        {listFilters ? <SearchForm placeholder="이름·전화·학교" defaultValue={searchQuery} /> : null}
      </div>
    </div>
  );
}
