import { ArrowDownRight, ArrowUpRight, ClipboardCheck, UserPlus, Users, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
  AttendanceSnapshot,
  PaymentSnapshot,
  TrendPoint,
} from "@/features/dashboard/server/queries";
import { Sparkline } from "./sparkline";

type Accent = "teal" | "sage" | "amber" | "coral";

type KpiCardData = {
  label: string;
  value: string;
  unit?: string;
  delta?: { value: string; positive: boolean };
  helper: string;
  icon: LucideIcon;
  spark: number[];
  accent: Accent;
  placeholder?: boolean;
};

const ACCENT: Record<Accent, { ring: string; icon: string; spark: string }> = {
  teal: { ring: "ring-chart-1/20", icon: "text-chart-1", spark: "--color-chart-1" },
  sage: { ring: "ring-chart-2/20", icon: "text-chart-2", spark: "--color-chart-2" },
  amber: { ring: "ring-chart-3/20", icon: "text-chart-3", spark: "--color-chart-3" },
  coral: { ring: "ring-chart-4/20", icon: "text-chart-4", spark: "--color-chart-4" },
};

export function KpiGrid({
  enrolled,
  newThisMonth,
  withdrawnThisMonth,
  attendance,
  payment,
  trend,
}: {
  enrolled: number;
  newThisMonth: number;
  withdrawnThisMonth: number;
  attendance: AttendanceSnapshot | null;
  payment: PaymentSnapshot | null;
  trend: TrendPoint[];
}) {
  const attendanceSpark = trend.map((p) => p.attendance);
  const enrolledSpark = trend.map((_, i) => enrolled - withdrawnThisMonth + Math.min(i, newThisMonth));

  const kpis: KpiCardData[] = [
    {
      label: "재원생",
      value: String(enrolled),
      unit: "명",
      delta: {
        value: `${newThisMonth - withdrawnThisMonth >= 0 ? "+" : ""}${newThisMonth - withdrawnThisMonth}`,
        positive: newThisMonth - withdrawnThisMonth >= 0,
      },
      helper: `이번 달 신규 ${newThisMonth} · 퇴원 ${withdrawnThisMonth}`,
      icon: Users,
      spark: enrolledSpark.length > 0 ? enrolledSpark : [enrolled],
      accent: "teal",
    },
    attendance && attendance.total > 0
      ? {
          label: "오늘 출석률",
          value: attendance.rate.toFixed(1),
          unit: "%",
          helper: `${attendance.present} / ${attendance.total}명 · 결석 ${attendance.absent} · 지각 ${attendance.late}`,
          icon: ClipboardCheck,
          spark: attendanceSpark.length > 0 ? attendanceSpark : [attendance.rate],
          accent: "sage",
        }
      : {
          label: "오늘 출석률",
          value: "—",
          helper: "오늘 기록된 출석이 없습니다",
          icon: ClipboardCheck,
          spark: [0],
          accent: "sage",
          placeholder: true,
        },
    payment && payment.totalCount > 0
      ? {
          label: "이번 달 수납률",
          value: payment.paymentRate.toFixed(1),
          unit: "%",
          helper: `완납 ${payment.paidCount} / ${payment.totalCount}건 · 미수 ${payment.unpaidCount}건`,
          icon: Wallet,
          spark: trend.map((p) => p.payment),
          accent: "amber",
        }
      : {
          label: "이번 달 수납률",
          value: "—",
          helper: "이번 달 청구 내역이 없습니다",
          icon: Wallet,
          spark: [0],
          accent: "amber",
          placeholder: true,
        },
    {
      label: "진행 중 상담",
      value: "—",
      helper: "상담 모델 도입 후 표시 (Phase 5)",
      icon: UserPlus,
      spark: [0],
      accent: "coral",
      placeholder: true,
    },
  ];

  return (
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {kpis.map((kpi) => (
        <KpiCard key={kpi.label} {...kpi} />
      ))}
    </section>
  );
}

function KpiCard({
  label,
  value,
  unit,
  delta,
  helper,
  icon: Icon,
  spark,
  accent,
  placeholder,
}: KpiCardData) {
  const a = ACCENT[accent];
  return (
    <article
      className={`bg-card border-border relative flex flex-col gap-4 overflow-hidden rounded-lg border p-5 ${
        placeholder ? "opacity-60" : ""
      }`}
    >
      <header className="flex items-center justify-between">
        <p className="eyebrow">{label}</p>
        <span
          className={`inline-flex size-7 items-center justify-center rounded-md ring-1 ${a.ring}`}
        >
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
        {delta ? (
          <div className="flex items-center gap-2 text-xs">
            <span
              className={`num inline-flex items-center gap-0.5 font-semibold ${
                delta.positive ? "text-chart-2" : "text-chart-4"
              }`}
            >
              {delta.positive ? (
                <ArrowUpRight className="size-3.5" strokeWidth={2.5} />
              ) : (
                <ArrowDownRight className="size-3.5" strokeWidth={2.5} />
              )}
              {delta.value}
            </span>
            <span className="text-muted-foreground">이번 달</span>
          </div>
        ) : (
          <p className="text-muted-foreground text-xs">{placeholder ? "준비 중" : "—"}</p>
        )}
      </div>

      <p className="text-muted-foreground num border-border border-t pt-3 text-xs leading-relaxed">
        {helper}
      </p>

      {placeholder ? null : (
        <div className="-mx-2 -mb-1 h-10">
          <Sparkline data={spark} colorVar={a.spark} />
        </div>
      )}
    </article>
  );
}
