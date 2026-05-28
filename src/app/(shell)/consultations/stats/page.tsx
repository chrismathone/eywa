import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAccess } from "@/lib/auth/require-access";
import {
  getConsultationByCategory,
  getConsultationFunnel,
  getConsultationTrend,
} from "@/features/consultations/server/queries";
import { StatsCharts } from "./_charts";

export const metadata = { title: "상담 통계 — eywa" };

export default async function ConsultationStatsPage() {
  await requireAccess("consultations");

  const [funnel, byCategory, trend] = await Promise.all([
    getConsultationFunnel(6),
    getConsultationByCategory(6),
    getConsultationTrend(6),
  ]);

  return (
    <div className="space-y-6">
      <Link
        href="/consultations"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition"
      >
        <ArrowLeft className="size-3.5" />
        학생상담으로
      </Link>

      <header className="border-border border-b pb-5">
        <p className="eyebrow">상담 통계</p>
        <h1 className="display text-foreground text-2xl">최근 6개월</h1>
        <p className="text-muted-foreground mt-1 text-sm">전환율 · 사유 분포 · 월별 추세</p>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="등록상담" value={funnel.enrollmentConsultations} unit="건" />
        <Stat label="학생상담" value={funnel.studentConsultations} unit="건" />
        <Stat
          label="학생 전환"
          value={funnel.enrolled}
          unit="건"
          highlight="text-chart-2"
        />
        <Stat
          label="전환율"
          value={Math.round(funnel.conversionRate * 10) / 10}
          unit="%"
          highlight="text-chart-2"
        />
      </section>

      <StatsCharts byCategory={byCategory} trend={trend} />
    </div>
  );
}

function Stat({
  label,
  value,
  unit,
  highlight,
}: {
  label: string;
  value: number;
  unit: string;
  highlight?: string;
}) {
  return (
    <div className="bg-card border-border rounded-md border p-4">
      <p className="eyebrow">{label}</p>
      <p className={`num text-foreground mt-1 text-2xl font-bold ${highlight ?? ""}`}>
        {value}
        <span className="text-muted-foreground ml-1 text-xs font-normal">{unit}</span>
      </p>
    </div>
  );
}
