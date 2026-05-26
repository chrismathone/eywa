import { ArrowDownRight, ArrowUpRight, ClipboardCheck, UserPlus, Users, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Sparkline } from "./sparkline";

type Accent = "teal" | "sage" | "amber" | "coral";

type KpiData = {
  label: string;
  value: string;
  unit?: string;
  delta: { value: string; positive: boolean };
  helper: string;
  icon: LucideIcon;
  spark: number[];
  accent: Accent;
};

const KPIS: KpiData[] = [
  {
    label: "재원생",
    value: "248",
    unit: "명",
    delta: { value: "+12", positive: true },
    helper: "이번 달 신규 14 · 퇴원 2",
    icon: Users,
    spark: [232, 234, 235, 238, 240, 244, 246, 248],
    accent: "teal",
  },
  {
    label: "오늘 출석률",
    value: "94.2",
    unit: "%",
    delta: { value: "+1.8pt", positive: true },
    helper: "234 / 248명 · 결석 9 · 지각 5",
    icon: ClipboardCheck,
    spark: [88, 91, 89, 92, 93, 94, 92, 94],
    accent: "sage",
  },
  {
    label: "이번 달 수납률",
    value: "87.1",
    unit: "%",
    delta: { value: "-2.4pt", positive: false },
    helper: "216 / 248건 · 미수금 32건",
    icon: Wallet,
    spark: [82, 84, 86, 88, 91, 90, 88, 87],
    accent: "amber",
  },
  {
    label: "진행 중 상담",
    value: "11",
    unit: "건",
    delta: { value: "+3", positive: true },
    helper: "신규 7 · AI 분석 대기 4",
    icon: UserPlus,
    spark: [5, 6, 7, 8, 8, 10, 10, 11],
    accent: "coral",
  },
];

const ACCENT: Record<Accent, { ring: string; icon: string; spark: string }> = {
  teal: { ring: "ring-chart-1/20", icon: "text-chart-1", spark: "--color-chart-1" },
  sage: { ring: "ring-chart-2/20", icon: "text-chart-2", spark: "--color-chart-2" },
  amber: { ring: "ring-chart-3/20", icon: "text-chart-3", spark: "--color-chart-3" },
  coral: { ring: "ring-chart-4/20", icon: "text-chart-4", spark: "--color-chart-4" },
};

export function KpiGrid() {
  return (
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {KPIS.map((kpi) => (
        <KpiCard key={kpi.label} {...kpi} />
      ))}
    </section>
  );
}

function KpiCard({ label, value, unit, delta, helper, icon: Icon, spark, accent }: KpiData) {
  const a = ACCENT[accent];
  return (
    <article className="bg-card border-border relative flex flex-col gap-4 overflow-hidden rounded-lg border p-5">
      <header className="flex items-center justify-between">
        <p className="eyebrow">{label}</p>
        <span className={`inline-flex size-7 items-center justify-center rounded-md ring-1 ${a.ring}`}>
          <Icon className={`size-3.5 ${a.icon}`} />
        </span>
      </header>

      <div className="space-y-1">
        <div className="flex items-end gap-1">
          <span className="display num text-foreground text-[44px]">{value}</span>
          {unit ? (
            <span className="text-muted-foreground mb-1.5 text-sm font-medium">{unit}</span>
          ) : null}
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span
            className={`num inline-flex items-center gap-0.5 font-semibold ${
              delta.positive ? "text-chart-2" : "text-chart-4"
            }`}
          >
            {delta.positive ? (
              <ArrowUpRight className="size-3" />
            ) : (
              <ArrowDownRight className="size-3" />
            )}
            {delta.value}
          </span>
          <span className="text-muted-foreground">최근 7일</span>
        </div>
      </div>

      <p className="text-muted-foreground num border-border border-t pt-3 text-xs leading-relaxed">
        {helper}
      </p>

      <div className="-mx-2 -mb-1 h-10">
        <Sparkline data={spark} colorVar={a.spark} />
      </div>
    </article>
  );
}
