import Link from "next/link";
import { WindowLink } from "@/components/workspace/window-link";
import { BarChart3 } from "lucide-react";
import { FilterSelect } from "@/components/filter-select";

type Props = {
  selectedMonth: string | null;
  selectedConsultant: string | null;
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

function buildQuery(month: string | null, consultant: string | null): string {
  const params = new URLSearchParams();
  if (month) params.set("month", month);
  if (consultant) params.set("consultant", consultant);
  const s = params.toString();
  return s ? `?${s}` : "";
}

export function KanbanFilters({ selectedMonth, selectedConsultant, consultants }: Props) {
  const displayMonth = selectedMonth ?? currentMonthKey();
  const prevMonth = shiftMonth(displayMonth, -1);
  const nextMonth = shiftMonth(displayMonth, 1);

  return (
    <div className="border-border bg-card flex flex-wrap items-center gap-3 rounded-lg border px-4 py-2.5">
      {/* 월 navigator */}
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground shrink-0 text-xs">월</span>
        <Link
          href={`/enrollment${buildQuery(prevMonth, selectedConsultant)}`}
          className="border-border hover:bg-accent/30 inline-flex size-7 items-center justify-center rounded-sm border text-xs"
          aria-label="이전 달"
        >
          ◀
        </Link>
        <span className="text-foreground min-w-[88px] text-center text-[13px] font-semibold tabular-nums">
          {formatMonth(displayMonth)}
        </span>
        <Link
          href={`/enrollment${buildQuery(nextMonth, selectedConsultant)}`}
          className="border-border hover:bg-accent/30 inline-flex size-7 items-center justify-center rounded-sm border text-xs"
          aria-label="다음 달"
        >
          ▶
        </Link>
        <Link
          href={`/enrollment${buildQuery(null, selectedConsultant)}`}
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

      <WindowLink
        href="/enrollment/dashboard"
        title="등록상담 대시보드"
        className="text-muted-foreground hover:text-foreground ml-auto inline-flex items-center gap-1.5 text-xs"
      >
        <BarChart3 className="size-3.5" />
        대시보드 보기
      </WindowLink>
    </div>
  );
}

