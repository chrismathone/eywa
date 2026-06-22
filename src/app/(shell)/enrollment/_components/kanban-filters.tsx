import Link from "next/link";
import { WindowLink } from "@/components/workspace/window-link";
import { BarChart3 } from "lucide-react";
import { FilterSelect } from "@/components/filter-select";
import { EyIcon } from "@/components/icons/eywa-icons";
import { Button } from "@/components/ui/button";

type Props = {
  selectedMonth: string | null;
  selectedConsultant: string | null;
  searchQuery: string | null;
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

function buildQuery(month: string | null, consultant: string | null, q: string | null): string {
  const params = new URLSearchParams();
  if (month) params.set("month", month);
  if (consultant) params.set("consultant", consultant);
  if (q) params.set("q", q);
  const s = params.toString();
  return s ? `?${s}` : "";
}

export function KanbanFilters({ selectedMonth, selectedConsultant, searchQuery, consultants }: Props) {
  const displayMonth = selectedMonth ?? currentMonthKey();
  const prevMonth = shiftMonth(displayMonth, -1);
  const nextMonth = shiftMonth(displayMonth, 1);

  return (
    <div className="border-border bg-card flex flex-wrap items-center gap-3 rounded-lg border px-4 py-2.5">
      {/* 월 navigator */}
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground shrink-0 text-xs">월</span>
        <Link
          href={`/enrollment${buildQuery(prevMonth, selectedConsultant, searchQuery)}`}
          className="border-border hover:bg-accent/30 inline-flex size-7 items-center justify-center rounded-sm border text-xs"
          aria-label="이전 달"
        >
          ◀
        </Link>
        <span className="text-foreground min-w-[88px] text-center text-[13px] font-semibold tabular-nums">
          {formatMonth(displayMonth)}
        </span>
        <Link
          href={`/enrollment${buildQuery(nextMonth, selectedConsultant, searchQuery)}`}
          className="border-border hover:bg-accent/30 inline-flex size-7 items-center justify-center rounded-sm border text-xs"
          aria-label="다음 달"
        >
          ▶
        </Link>
        <Link
          href={`/enrollment${buildQuery(null, selectedConsultant, searchQuery)}`}
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

      {/* 이름·전화·학교 검색 (월/상담사 hidden 보존, page 리셋) */}
      <form action="/enrollment" method="get" className="ml-auto flex items-center gap-2">
        {selectedMonth ? <input type="hidden" name="month" value={selectedMonth} /> : null}
        {selectedConsultant ? <input type="hidden" name="consultant" value={selectedConsultant} /> : null}
        <div className="border-border bg-bg-soft text-text-dim flex items-center gap-2 rounded-sm border px-2.5 py-1.5">
          <EyIcon name="search" size={13} />
          <input
            type="search"
            name="q"
            defaultValue={searchQuery ?? ""}
            placeholder="이름·전화·학교"
            className="text-foreground placeholder:text-text-faint w-32 bg-transparent text-xs focus:outline-none"
          />
        </div>
        <Button type="submit" variant="outline" size="sm">
          검색
        </Button>
      </form>

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

