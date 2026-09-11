import type { ReactNode } from "react";
import { FilterSelect } from "@/components/filter-select";
import { PeriodNav } from "@/components/period-nav";
import { SearchToggle } from "@/components/search-toggle";
import { ToolbarChip } from "@/components/toolbar";
import { TOOLBAR_SELECT } from "@/components/toolbar-controls";
import { EyIcon } from "@/components/icons/eywa-icons";
import { BOARD_STAGE_OPTIONS, type BoardStageKey } from "@/features/enrollment/board-stages";
import { MonthPicker } from "./month-picker";
import { enrollmentHref, formatMonthLabel, shiftMonth, type EnrollmentView } from "./enrollment-query";
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
  /**
   * 접수일 필터(`received=YYYY-MM-DD`, 운영실 KPI '신규문의' ↗) — 걸려 있으면 칩 하나로 보이고 눌러 푼다.
   * 이 필터는 월·기간보다 우선이라, 기간을 고르거나 월을 옮기면 함께 풀린다(clearParams·enrollmentHref).
   */
  receivedDay?: string | null;
};

/**
 * 🔴 디자인 지시서 §10 그대로(원장 2026-09-03 *"남은 결정사항은 지시서 그대로 해 봐"*): 툴바에 **칩 줄·아이콘 열을
 *    두지 않는다**. 기간 프리셋(칩 3개)·보기 전환(아이콘 칩 3개)은 각각 **라벨 하나(드롭다운)**로 접었고, 검색은 눌러야
 *    나온다(SearchToggle). 남는 컨트롤 = 월 이동(PeriodNav) · 연·월 · 기간 · 상담사 · 상태 · 보기 · 검색 — 전부 같은
 *    control-scale 치수(`TOOLBAR_SELECT`)라 한 줄에 밑선이 맞는다. 09-01의 "라운드 덜 둥근 쪽" 규약은 그 안에 들어 있다.
 */
const RANGE_OPTIONS = RANGE_PRESETS.map((r) => ({ value: r, label: RANGE_LABEL[r] }));
const VIEW_OPTIONS: { value: Exclude<EnrollmentView, "kanban">; label: string }[] = [
  { value: "table", label: "목록" },
  { value: "stats", label: "통계" },
];

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
  receivedDay,
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

      {/* 기간 프리셋 — 🔴 '전체'는 없다(원장 2026-08-04). 이관으로 3년치가 쌓여 전건을 열면 칸반이 카드 2,197장이
          된다. 구간 길이는 최대 1년. 특정 달을 보는 중이면 값이 비고("기간"), 여기서 하나를 고르면 그 달은 풀린다
          (clearParams — 옛 칩 링크가 month:null을 실어 보내던 것과 같은 뜻). */}
      <FilterSelect
        paramName="range"
        value={selectedMonth ? "" : selectedRange}
        options={RANGE_OPTIONS}
        axisLabel="기간"
        ariaLabel="기간 프리셋"
        className="w-auto"
        triggerClassName={TOOLBAR_SELECT}
        clearParams={["month", "received"]}
      />

      {/* 상담사 — 라벨 하나(드롭다운). 고른 값이 곧 라벨이다. */}
      <FilterSelect
        paramName="consultant"
        value={selectedConsultant}
        options={consultants.map((c) => ({ value: c.id, label: c.name }))}
        axisLabel="상담사"
        ariaLabel="상담사 필터"
        className="w-auto"
        triggerClassName={TOOLBAR_SELECT}
      />

      {/* 진행 상태 — 🔴 **칸반과 같은 4단계**(원장 2026-09-01 *"상태 드랍다운도 4단계로 통일해야지"*). 선택지는
          board-stages 단일 소스라 칸 이름과 절대 갈리지 않는다. ⚠️ 파라미터 이름은 `outcome` 그대로고 값만 칸 키다. */}
      <FilterSelect
        paramName="outcome"
        value={selectedStage}
        options={BOARD_STAGE_OPTIONS}
        axisLabel="상태"
        ariaLabel="진행 단계 필터"
        className="w-auto"
        triggerClassName={TOOLBAR_SELECT}
      />
      {/* 접수일 칩 — 눌러 푼다(링크는 received만 뺀 지금 필터 그대로). */}
      {receivedDay ? (
        <ToolbarChip active href={enrollmentHref({ ...base, month: selectedMonth })}>
          접수일: {Number(receivedDay.slice(5, 7))}월 {Number(receivedDay.slice(8, 10))}일
          <EyIcon name="close" size={12} aria-hidden />
        </ToolbarChip>
      ) : null}
        </>
      ) : null}

      {yearChips}

      {/* 보기 전환(칸반 · 목록 · 통계) — 지시서 §9 "보기 전환은 2차": 아이콘 칩 3개 대신 라벨 하나. 기본(칸반)은
          파라미터가 없다(allValue). ⚠️ 통계는 집계 화면이라 월·기간·상담사 필터를 안 물려받는다 — 남은 파라미터는 무시된다. */}
      <FilterSelect
        paramName="view"
        value={view}
        options={VIEW_OPTIONS}
        allValue="kanban"
        allLabel="칸반"
        axisLabel="보기"
        ariaLabel="보기 전환"
        className="w-auto"
        triggerClassName={TOOLBAR_SELECT}
      />

      {/* 오른쪽 묶음 — 동기화 배지가 자기 줄을 통째로 쓰던 걸 여기로 당겨 한 줄 줄였다(원장 2026-08-05).
          🔴 '대시보드 보기' 링크는 **뺐다**(원장 2026-09-01 *"대시보드 보기는 일단 제거해. 통계뷰가
          있으니까"*) — 바로 옆 뷰 토글의 '통계'와 같은 일을 하는 두 번째 입구였다. 라우트
          (`/enrollment/dashboard`)는 살아 있으니 되살릴 땐 이 자리에 링크만 다시 놓으면 된다. */}
      <div className="ml-auto flex items-center gap-3">
        {/* 동기화 시각 표시만 남는다 — '지금 동기화' 버튼은 없앴다(주간 자동, 손으로 돌릴 일은 연동 면). */}
        {syncBadge}
        {stats}
        {/* 🔴 검색은 **맨 오른쪽**(원장 2026-09-01 *"검색창 최우측으로"*)이되 **눌러야 나온다**(§10). 이름·전화·학교
            검색은 클라 내비(SearchForm)라 화면 깜빡 없이 결과만 교체된다(다른 param 자동 보존). */}
        {listFilters ? <SearchToggle placeholder="이름·전화·학교" defaultValue={searchQuery ?? undefined} /> : null}
      </div>
    </div>
  );
}
