import { BackLink } from "@/components/back-link";
import { WindowLink } from "@/components/workspace/window-link";
import { Pill } from "@/components/atoms/pill";
import { EyIcon } from "@/components/icons/eywa-icons";
import { requireAccess } from "@/lib/auth/require-access";
import { relativeTimeKo } from "@/lib/relative-time";
import {
  getConsultationByCategory,
  getConsultationFunnel,
  getConsultationTrend,
  getStudentsNeedingConsultation,
} from "@/features/consultations/server/queries";
import { StatsCharts } from "./_charts";

export const metadata = { title: "상담 통계 — eywa" };

export default async function ConsultationStatsPage() {
  await requireAccess("consultations");

  const [funnel, byCategory, trend, needed] = await Promise.all([
    getConsultationFunnel(6),
    getConsultationByCategory(6),
    getConsultationTrend(6),
    getStudentsNeedingConsultation(30),
  ]);

  return (
    <div className="space-y-6">
      <BackLink href="/consultations" label="학생상담으로" />

      <header className="border-border border-b pb-5">
        <p className="eyebrow">상담 통계</p>
        <h1 className="font-bold tracking-tight text-foreground text-2xl">최근 6개월</h1>
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

      {/* 상담 필요 학생 — 30일 이상 미상담(또는 미상담 이력) 재원생 워크리스트 */}
      <section className="bg-card border-border rounded-md border p-5">
        <header className="mb-3 flex items-baseline justify-between">
          <h2 className="text-foreground text-sm font-bold">
            상담 필요 학생
            <span className="text-muted-foreground num ml-2 text-xs font-normal">
              30일+ 미상담 {needed.total}명
            </span>
          </h2>
        </header>
        {needed.rows.length === 0 ? (
          <p className="text-muted-foreground flex items-center justify-center gap-1.5 py-6 text-center text-sm">
            <EyIcon name="success" size={16} className="text-primary" />
            최근 30일 내 모든 재원생을 상담했습니다
          </p>
        ) : (
          <ul className="divide-border divide-y">
            {needed.rows.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-2">
                <div className="flex items-center gap-2">
                  <WindowLink
                    href={`/students/${s.id}`}
                    title={s.name}
                    className="text-foreground text-sm font-medium hover:underline"
                  >
                    {s.name}
                  </WindowLink>
                  {s.grade ? <span className="text-text-dim text-xs">{s.grade}</span> : null}
                </div>
                <div className="flex items-center gap-2">
                  {s.lastConsultedAt === null ? (
                    <Pill color="danger">상담 이력 없음</Pill>
                  ) : (
                    <span className="text-text-dim num text-xs">{relativeTimeKo(s.lastConsultedAt)} 상담</span>
                  )}
                  <WindowLink
                    href={`/consultations/new?studentId=${s.id}`}
                    title="새 상담"
                    className="text-chart-1 text-[11px] hover:underline"
                  >
                    상담 기록 +
                  </WindowLink>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
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
