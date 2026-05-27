/**
 * KPI 카드 4개 — 시안 사양:
 * 11px mono label + 26×26 아이콘박스 + 32px 800 value + 12px unit
 * + 11px delta pill + 11px helper (border-top)
 * + 우상단 100×100 색 글로우
 */
import { EyIcon, type EywaIconName } from "@/components/icons/eywa-icons";
import type {
  AttendanceSnapshot,
  ConsultationPipeline,
  PaymentSnapshot,
  TrendPoint,
} from "@/features/dashboard/server/queries";

type KpiColor = "primary" | "blue" | "gold" | "purple";

type KpiData = {
  label: string;
  value: string;
  unit?: string;
  delta?: { value: string; positive: boolean };
  helper: string;
  icon: EywaIconName;
  color: KpiColor;
};

const COLOR_CLASS: Record<KpiColor, { text: string; bg: string; glow: string }> = {
  primary: { text: "text-primary", bg: "bg-primary-soft", glow: "bg-primary/10" },
  blue: { text: "text-blue", bg: "bg-blue-soft", glow: "bg-blue/10" },
  gold: { text: "text-gold", bg: "bg-gold-soft", glow: "bg-gold/10" },
  purple: { text: "text-purple", bg: "bg-purple-soft", glow: "bg-purple/10" },
};

export function KpiGrid({
  enrolled,
  newThisMonth,
  withdrawnThisMonth,
  attendance,
  payment,
  consultations,
}: {
  enrolled: number;
  newThisMonth: number;
  withdrawnThisMonth: number;
  attendance: AttendanceSnapshot | null;
  payment: PaymentSnapshot | null;
  consultations: ConsultationPipeline;
  trend: TrendPoint[];
}) {
  const enrolledDelta = newThisMonth - withdrawnThisMonth;

  const kpis: KpiData[] = [
    {
      label: "재원생",
      value: String(enrolled),
      unit: "명",
      delta: {
        value: `${enrolledDelta >= 0 ? "+" : ""}${enrolledDelta}`,
        positive: enrolledDelta >= 0,
      },
      helper: `신규 ${newThisMonth} · 퇴원 ${withdrawnThisMonth}`,
      icon: "seed",
      color: "primary",
    },
    attendance && attendance.total > 0
      ? {
          label: "오늘 출석률",
          value: attendance.rate.toFixed(1),
          unit: "%",
          helper: `${attendance.present}/${attendance.total}명 · 결석 ${attendance.absent}`,
          icon: "pulse",
          color: "blue",
        }
      : {
          label: "오늘 출석률",
          value: "—",
          helper: "오늘 기록된 출석이 없습니다",
          icon: "pulse",
          color: "blue",
        },
    payment && payment.totalCount > 0
      ? {
          label: "이번 달 수납률",
          value: payment.paymentRate.toFixed(1),
          unit: "%",
          helper: `완납 ${payment.paidCount}/${payment.totalCount}건 · 미수 ${payment.unpaidCount}건`,
          icon: "pollen",
          color: "gold",
        }
      : {
          label: "이번 달 수납률",
          value: "—",
          helper: "이번 달 청구 내역이 없습니다",
          icon: "pollen",
          color: "gold",
        },
    {
      label: "진행 중 상담",
      value: String(consultations.total),
      unit: "건",
      delta: {
        value: `+${consultations.pending + consultations.scheduled}`,
        positive: true,
      },
      helper: `신규 ${consultations.pending + consultations.scheduled} · AI 대기 ${consultations.aiDone}`,
      icon: "sprout",
      color: "purple",
    },
  ];

  return (
    <section className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
      {kpis.map((kpi) => (
        <KpiCard key={kpi.label} {...kpi} />
      ))}
    </section>
  );
}

function KpiCard({ label, value, unit, delta, helper, icon, color }: KpiData) {
  const c = COLOR_CLASS[color];
  return (
    <article className="bg-card border-line shadow-card relative overflow-hidden rounded-2xl border p-5">
      {/* 우상단 글로우 */}
      <span
        className={`pointer-events-none absolute -top-8 -right-8 size-[100px] rounded-full blur-md ${c.glow}`}
        aria-hidden="true"
      />

      <header className="relative flex items-center justify-between">
        <p className="micro">{label}</p>
        <span
          className={`flex size-[26px] items-center justify-center rounded-md ${c.bg} ${c.text}`}
        >
          <EyIcon name={icon} size={14} />
        </span>
      </header>

      <div className="relative mt-3 flex items-baseline gap-1.5">
        <span className="tabular text-foreground text-[32px] leading-none">{value}</span>
        {unit ? <span className="text-text-dim text-xs">{unit}</span> : null}
      </div>

      {delta ? (
        <div className="relative mt-2 flex items-center gap-2">
          <span
            className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[11px] font-bold ${
              delta.positive
                ? "bg-primary-soft text-primary"
                : "bg-danger-soft text-danger"
            }`}
          >
            {delta.value}
          </span>
          <span className="text-text-faint text-[11px]">이번 달</span>
        </div>
      ) : (
        <div className="relative mt-2 h-[18px]" />
      )}

      <p className="text-text-dim border-line num relative mt-3 border-t pt-3 text-[11px] leading-relaxed">
        {helper}
      </p>
    </article>
  );
}
