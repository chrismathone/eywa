import type { ReactNode } from "react";
import { EmbedLink } from "@/components/embed-link";
import { FilterSelect, type FilterSelectOption } from "@/components/filter-select";
import { SearchToggle } from "@/components/search-toggle";
import { Toolbar, ToolbarChip } from "@/components/toolbar";
import { TOOLBAR_SELECT } from "@/components/toolbar-controls";
import { CONTROL_H, CONTROL_LABEL } from "@/components/ui/control-scale";
import type { ListFilters } from "@/features/withdrawal-reports/list-items";
// 기간 '직접 지정' 날짜 두 칸 — 퇴원관리와 같은 부품(주소의 다른 값·embed를 그대로 들고 간다).
import { CustomRange } from "../../withdrawals/_components/custom-range";

const SELECT_PROPS = { className: "w-auto", triggerClassName: TOOLBAR_SELECT } as const;
/** 기간 = 퇴원·종료일. 선택지는 퇴원관리와 같다(창 계산은 `listWindow`). */
const RANGE_OPTIONS: FilterSelectOption[] = [
  { value: "month", label: "이번 달" },
  { value: "30d", label: "최근 30일" },
  { value: "90d", label: "최근 90일" },
  { value: "year", label: "최근 1년" },
  { value: "custom", label: "직접 지정" },
];
/** 구분(원장 2026-10-30 — 목록 '구분' 열과 같은 값). 기존 기록은 구분이 없어 고르면 빠진다. */
const KIND_OPTIONS: FilterSelectOption[] = [
  { value: "withdrawal", label: "퇴원" },
  { value: "subject_end", label: "수강종료" },
];
const STATUS_OPTIONS: FilterSelectOption[] = [
  { value: "pending", label: "진행 중" },
  { value: "completed", label: "처리 완료" },
  { value: "canceled", label: "요청 취소" },
];

/**
 * 퇴원보고서 툴바 — 퇴원관리처럼 축마다 드롭다운 하나(`상태: 전체` · `기간: 최근 30일` · 과목 · 작성 강사) + 검색 토글.
 * 기존 스프레드시트 기록을 보는 사람(작성 요청 권한)에겐 '스프레드시트 기록' 상태가 더 선다.
 * 학생 미연결 칩은 없앴다(원장 2026-10-30 *"어차피 지난 기록이라 따로 필터링 안되도 상관없어"*).
 */
export function ListToolbar({
  filters,
  custom,
  subjects,
  teachers,
  archiveStatus,
  mine,
  hideCanceled,
  resultText,
  resetHref,
  request,
}: {
  filters: ListFilters;
  custom?: { from: string; to: string };
  subjects: FilterSelectOption[];
  teachers: FilterSelectOption[];
  /** 기존 기록을 보는 사람만 — 상태 선택지에 '스프레드시트 기록'을 더한다. */
  archiveStatus: boolean;
  /** 지금 내 승인 차례인 보고서 칩(누르면 켜고 끈다) — 0건이고 꺼져 있으면 없다. */
  mine: { href: string; count: number } | null;
  /** 요청 취소 숨기기 칩(기본 켜짐) — 상태를 따로 고르면 뜻이 없어 없다. `count` = 지금 조건의 요청 취소 건수. */
  hideCanceled: { active: boolean; href: string; count: number } | null;
  resultText: string;
  resetHref: string | null;
  request: ReactNode;
}) {
  return (
    <Toolbar>
      <FilterSelect
        paramName="status"
        value={filters.status === "all" ? "" : filters.status}
        options={archiveStatus ? [...STATUS_OPTIONS, { value: "archive", label: "스프레드시트 기록" }] : STATUS_OPTIONS}
        axisLabel="상태"
        ariaLabel="상태 필터"
        {...SELECT_PROPS}
      />
      {/* 기간을 바꾸면 `from=`·`to=`는 지운다 — 옛 날짜가 붙어 남지 않게. */}
      <FilterSelect
        paramName="range"
        value={filters.range === "all" ? "" : filters.range}
        options={RANGE_OPTIONS}
        axisLabel="기간"
        ariaLabel="기간 필터"
        clearParams={["from", "to"]}
        {...SELECT_PROPS}
      />
      {custom ? <CustomRange key={`${custom.from}~${custom.to}`} from={custom.from} to={custom.to} /> : null}
      <FilterSelect
        paramName="subject"
        value={filters.subject === "all" ? "" : filters.subject}
        options={subjects}
        axisLabel="과목"
        ariaLabel="과목 필터"
        {...SELECT_PROPS}
      />
      <FilterSelect
        paramName="kind"
        value={filters.kind === "all" ? "" : filters.kind}
        options={KIND_OPTIONS}
        axisLabel="구분"
        ariaLabel="구분 필터"
        {...SELECT_PROPS}
      />
      {teachers.length > 1 || filters.teacher !== "all" ? (
        <FilterSelect
          paramName="teacher"
          value={filters.teacher === "all" ? "" : filters.teacher}
          options={teachers}
          axisLabel="작성 강사"
          ariaLabel="작성 강사 필터"
          // 직원 이름 + 시트 원문 이름이라 50개를 넘을 수 있다 — 기본 상한이면 뒤에 서는 로마자 이름이 잘린다([[#84]]).
          cap={500}
          {...SELECT_PROPS}
        />
      ) : null}
      {mine ? (
        <ToolbarChip active={filters.mine} href={mine.href}>
          내 승인 필요 <span className="num">{mine.count}</span>건
        </ToolbarChip>
      ) : null}
      {hideCanceled ? (
        <ToolbarChip active={hideCanceled.active} href={hideCanceled.href}>
          요청 취소 숨기기 <span className="num">{hideCanceled.count}</span>건
        </ToolbarChip>
      ) : null}
      <SearchToggle placeholder="학생·학교·반·내용" defaultValue={filters.q} />
      {resetHref ? (
        <EmbedLink
          href={resetHref}
          className={`${CONTROL_H} ${CONTROL_LABEL} text-text-faint hover:text-foreground inline-flex items-center px-1 whitespace-nowrap transition`}
        >
          필터 초기화
        </EmbedLink>
      ) : null}
      <span className={`${CONTROL_LABEL} text-text-faint num whitespace-nowrap`}>{resultText}</span>
      <div className="ml-auto">{request}</div>
    </Toolbar>
  );
}
