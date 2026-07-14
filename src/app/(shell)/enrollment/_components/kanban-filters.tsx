import Link from "next/link";
import { WindowLink } from "@/components/workspace/window-link";
import { BarChart3, LayoutGrid, List } from "@/components/icons/eywa-icon-compat";
import { EyIcon } from "@/components/icons/eywa-icons";
import { FilterSelect } from "@/components/filter-select";
import { SearchForm } from "@/components/search-form";
import { OUTCOME_OPTIONS } from "./outcome-meta";

type Props = {
  selectedMonth: string | null;
  selectedConsultant: string | null;
  selectedOutcome: string | null;
  searchQuery: string | null;
  view: "kanban" | "table";
  consultants: { id: string; name: string }[];
};

function formatMonth(key: string): string {
  const [y, m] = key.split("-");
  return `${y}년 ${Number(m)}월`;
}

function shiftMonth(key: string | null, delta: number): string {
  const now = new Date();
  const base = key
    ? new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, 1)
    : new Date(now.getFullYear(), now.getMonth(), 1);
  base.setMonth(base.getMonth() + delta);
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}`;
}

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function buildQuery(p: {
  month: string | null;
  consultant: string | null;
  outcome: string | null;
  q: string | null;
  view: "kanban" | "table";
}): string {
  const params = new URLSearchParams();
  if (p.month) params.set("month", p.month);
  if (p.consultant) params.set("consultant", p.consultant);
  if (p.outcome) params.set("outcome", p.outcome);
  if (p.q) params.set("q", p.q);
  if (p.view === "table") params.set("view", "table");
  const s = params.toString();
  return s ? `?${s}` : "";
}

export function KanbanFilters({
  selectedMonth,
  selectedConsultant,
  selectedOutcome,
  searchQuery,
  view,
  consultants,
}: Props) {
  const displayMonth = selectedMonth ?? currentMonthKey();
  const base = {
    consultant: selectedConsultant,
    outcome: selectedOutcome,
    q: searchQuery,
    view,
  };
  const prevMonth = shiftMonth(displayMonth, -1);
  const nextMonth = shiftMonth(displayMonth, 1);

  return (
    <div className="border-border bg-card flex flex-wrap items-center gap-3 rounded-lg border px-4 py-2.5">
      {/* 월 navigator */}
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground shrink-0 text-xs">월</span>
        <Link
          href={`/enrollment${buildQuery({ ...base, month: prevMonth })}`}
          className="border-border hover:bg-accent/30 inline-flex size-7 items-center justify-center rounded-sm border text-xs"
          aria-label="이전 달"
        >
          <EyIcon name="chevronLeft" size={14} />
        </Link>
        <span className="text-foreground min-w-[88px] text-center text-[13px] font-semibold tabular-nums">
          {formatMonth(displayMonth)}
        </span>
        <Link
          href={`/enrollment${buildQuery({ ...base, month: nextMonth })}`}
          className="border-border hover:bg-accent/30 inline-flex size-7 items-center justify-center rounded-sm border text-xs"
          aria-label="다음 달"
        >
          <EyIcon name="chevronRight" size={14} />
        </Link>
        <Link
          href={`/enrollment${buildQuery({ ...base, month: null })}`}
          className={`ml-1 rounded-md border px-2 py-0.5 text-xs transition ${
            !selectedMonth
              ? "border-foreground bg-foreground text-background font-medium"
              : "border-border text-muted-foreground hover:text-foreground hover:bg-accent/30"
          }`}
        >
          전체
        </Link>
      </div>

      <span className="text-muted-foreground/40 hidden text-xs sm:inline">·</span>

      {/* 상담사 dropdown */}
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground shrink-0 text-xs">상담사</span>
        <FilterSelect
          paramName="consultant"
          value={selectedConsultant}
          options={consultants.map((c) => ({ value: c.id, label: c.name }))}
          ariaLabel="상담사 필터"
        />
      </div>

      {/* 진행 상태 dropdown (고급 필터) */}
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground shrink-0 text-xs">상태</span>
        <FilterSelect
          paramName="outcome"
          value={selectedOutcome}
          options={OUTCOME_OPTIONS}
          ariaLabel="진행 상태 필터"
          className="w-32"
        />
      </div>

      {/* 뷰 토글 — 칸반 ↔ 목록 */}
      <div className="border-border inline-flex items-center gap-0.5 rounded-md border p-0.5">
        <Link
          href={`/enrollment${buildQuery({ ...base, month: selectedMonth, view: "kanban" })}`}
          aria-label="칸반 보기"
          className={`inline-flex items-center gap-1 rounded-sm px-2 py-1 text-xs transition ${
            view === "kanban"
              ? "bg-foreground text-background font-medium"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <LayoutGrid className="size-3.5" />
          칸반
        </Link>
        <Link
          href={`/enrollment${buildQuery({ ...base, month: selectedMonth, view: "table" })}`}
          aria-label="목록 보기"
          className={`inline-flex items-center gap-1 rounded-sm px-2 py-1 text-xs transition ${
            view === "table"
              ? "bg-foreground text-background font-medium"
              : "text-muted-foreground hover:text-foreground"
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
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-xs"
      >
        <BarChart3 className="size-3.5" />
        대시보드 보기
      </WindowLink>
    </div>
  );
}
