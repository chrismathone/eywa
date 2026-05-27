import Link from "next/link";
import { BarChart3 } from "lucide-react";

type Props = {
  selectedMonth: string | null;
  selectedConsultant: string | null;
  consultants: { id: string; name: string }[];
};

function monthOptions(count = 12): { key: string; label: string }[] {
  const now = new Date();
  const out: { key: string; label: string }[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
    out.push({ key, label });
  }
  return out;
}

function buildQuery(month: string | null, consultant: string | null): string {
  const params = new URLSearchParams();
  if (month) params.set("month", month);
  if (consultant) params.set("consultant", consultant);
  const s = params.toString();
  return s ? `?${s}` : "";
}

export function KanbanFilters({ selectedMonth, selectedConsultant, consultants }: Props) {
  const months = monthOptions();

  return (
    <div className="border-border bg-card flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3">
      {/* Month chip group */}
      <div className="flex items-center gap-1.5 overflow-x-auto">
        <span className="text-muted-foreground shrink-0 text-xs">월</span>
        <Chip active={!selectedMonth} href={`/enrollment${buildQuery(null, selectedConsultant)}`}>
          전체
        </Chip>
        {months.map((m) => (
          <Chip
            key={m.key}
            active={selectedMonth === m.key}
            href={`/enrollment${buildQuery(m.key, selectedConsultant)}`}
          >
            {m.label}
          </Chip>
        ))}
      </div>

      <span className="text-muted-foreground/40 hidden text-xs sm:inline">·</span>

      <div className="flex items-center gap-1.5 overflow-x-auto">
        <span className="text-muted-foreground shrink-0 text-xs">상담사</span>
        <Chip active={!selectedConsultant} href={`/enrollment${buildQuery(selectedMonth, null)}`}>
          전체
        </Chip>
        {consultants.map((c) => (
          <Chip
            key={c.id}
            active={selectedConsultant === c.id}
            href={`/enrollment${buildQuery(selectedMonth, c.id)}`}
          >
            {c.name}
          </Chip>
        ))}
      </div>

      <Link
        href="/enrollment/dashboard"
        className="text-muted-foreground hover:text-foreground ml-auto inline-flex items-center gap-1.5 text-xs"
      >
        <BarChart3 className="size-3.5" />
        대시보드 보기
      </Link>
    </div>
  );
}

function Chip({
  active,
  href,
  children,
}: {
  active: boolean;
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`shrink-0 rounded-md border px-2 py-0.5 text-xs transition ${
        active
          ? "border-foreground bg-foreground text-background font-medium"
          : "border-border text-muted-foreground hover:text-foreground hover:bg-accent/30"
      }`}
    >
      {children}
    </Link>
  );
}
