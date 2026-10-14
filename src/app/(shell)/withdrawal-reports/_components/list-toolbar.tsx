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
const STATUS_OPTIONS: FilterSelectOption[] = [
  { value: "pending", label: "진행 중" },
  { value: "completed", label: "처리 완료" },
  { value: "canceled", label: "요청 취소" },
];

/**
 * 퇴원보고서 툴바 — 퇴원관리처럼 축마다 드롭다운 하나(`상태: 전체` · `기간: 최근 30일` · 과목 · 작성 강사) + 검색 토글.
 * 기존 스프레드시트 기록을 보는 사람(작성 요청 권한)에겐 '스프레드시트 기록' 상태와 **학생 미연결** 칩이 더 선다
 * (원장 2026-10-14 *"미연결 리스트만 따로 보면"*).
 */
export function ListToolbar({
  filters,
  custom,
  subjects,
  teachers,
  unmapped,
  resultText,
  resetHref,
  request,
}: {
  filters: ListFilters;
  custom?: { from: string; to: string };
  subjects: FilterSelectOption[];
  teachers: FilterSelectOption[];
  /** 기존 기록을 보는 사람만 — 미연결 칩의 주소(누르면 켜고 끈다)와 건수(상태 밖 다른 필터를 건 수). */
  unmapped: { href: string; count: number } | null;
  resultText: string;
  resetHref: string | null;
  request: ReactNode;
}) {
  return (
    <Toolbar>
      <FilterSelect
        paramName="status"
        value={filters.status === "all" ? "" : filters.status}
        options={unmapped ? [...STATUS_OPTIONS, { value: "archive", label: "스프레드시트 기록" }] : STATUS_OPTIONS}
        axisLabel="상태"
        ariaLabel="상태 필터"
        // 미연결은 기존 기록에만 있다 — 상태를 고르면 칩을 끈다(켜진 채면 진행 중·완료와 겹쳐 늘 0건).
        clearParams={["link"]}
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
      {unmapped ? (
        <ToolbarChip active={filters.unmapped} href={unmapped.href}>
          학생 미연결 <span className="num">{unmapped.count}</span>건
        </ToolbarChip>
      ) : null}
      <SearchToggle placeholder="학생·학교·반" defaultValue={filters.q} />
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
