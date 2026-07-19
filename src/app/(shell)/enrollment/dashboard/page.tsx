import Link from "next/link";
import { BackLink } from "@/components/back-link";
import { requireAccess } from "@/lib/auth/require-access";
import {
  getConsultantPerformance,
  getMonthlyConversionTrend,
  getMonthlyOutcomeDistribution,
} from "@/features/enrollment/server/queries";
import { ConversionBars } from "./_components/conversion-bars";
import { OutcomeDonut } from "./_components/outcome-donut";
import { kstMonth } from "@/lib/date-kst";

export const metadata = { title: "등록상담 대시보드 — eywa" };

function currentMonthKey(): string {
  return kstMonth();
}

function monthOptions(count = 6): { key: string; label: string }[] {
  const [ay, am] = kstMonth().split("-").map(Number); // KST 당월 기준 앵커
  const out: { key: string; label: string }[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(ay!, am! - 1 - i, 1);
    out.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: `${d.getFullYear()}년 ${d.getMonth() + 1}월`,
    });
  }
  return out;
}

export default async function EnrollmentDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  await requireAccess("enrollment");
  const { month } = await searchParams;
  const selectedMonth = month ?? currentMonthKey();

  const [distribution, trend, consultants] = await Promise.all([
    getMonthlyOutcomeDistribution(selectedMonth),
    getMonthlyConversionTrend(6),
    getConsultantPerformance(3),
  ]);

  const monthTotal = distribution.reduce((s, d) => s + d.count, 0);
  const monthEnrolled = distribution.find((d) => d.outcome === "enrolled")?.count ?? 0;
  const monthlyRate = monthTotal > 0 ? Math.round((monthEnrolled / monthTotal) * 100) : 0;

  return (
    <div className="space-y-6">
      <BackLink href="/enrollment" label="등록상담 칸반으로" />

      <header className="border-border space-y-1 border-b pb-5">
        <p className="eyebrow">등록상담 대시보드</p>
        <h1 className="font-bold tracking-tight text-foreground text-2xl">사업 인사이트</h1>
        <p className="text-muted-foreground text-sm">월별 상태 분포 · 전환율 추세 · 상담사별 실적</p>
      </header>

      {/* Month selector */}
      <div className="border-border bg-card flex flex-wrap items-center gap-1.5 rounded-lg border px-4 py-2.5">
        <span className="text-muted-foreground shrink-0 text-xs">월 선택</span>
        {monthOptions().map((m) => (
          <Link
            key={m.key}
            href={`/enrollment/dashboard?month=${m.key}`}
            className={`rounded-md border px-2 py-0.5 text-xs transition ${
              selectedMonth === m.key
                ? "border-foreground bg-foreground text-background font-medium"
                : "border-border text-muted-foreground hover:text-foreground hover:bg-accent/30"
            }`}
          >
            {m.label}
          </Link>
        ))}
      </div>

      {/* Stats KPI */}
      <section className="bg-card border-border grid grid-cols-2 gap-4 rounded-lg border p-5 sm:grid-cols-3">
        <Stat label="전체 상담" value={`${monthTotal}건`} />
        <Stat label="등록 완료" value={`${monthEnrolled}건`} highlight="text-chart-2" />
        <Stat label="전환율" value={`${monthlyRate}%`} highlight="text-chart-1" />
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="bg-card border-border rounded-lg border p-5">
          <header className="mb-3">
            <h2 className="text-foreground text-sm font-bold">월별 상태 분포</h2>
            <p className="text-muted-foreground text-xs">{selectedMonth} 기준 outcome별 카운트</p>
          </header>
          <OutcomeDonut data={distribution} />
        </section>

        <section className="bg-card border-border rounded-lg border p-5">
          <header className="mb-3">
            <h2 className="text-foreground text-sm font-bold">최근 6개월 전환율</h2>
            <p className="text-muted-foreground text-xs">상담 완료율 (consulted+ai+enrolled) / 등록 완료율</p>
          </header>
          <ConversionBars data={trend} />
        </section>
      </div>

      <section className="bg-card border-border rounded-lg border">
        <header className="border-border flex items-center justify-between border-b px-5 py-3">
          <div>
            <h2 className="text-foreground text-sm font-bold">상담사별 실적</h2>
            <p className="text-muted-foreground text-xs">최근 3개월</p>
          </div>
          <span className="text-muted-foreground num text-xs">{consultants.length}명</span>
        </header>
        {consultants.length === 0 ? (
          <div className="text-muted-foreground px-5 py-8 text-center text-sm">데이터 없음</div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-border text-muted-foreground border-b text-left text-xs [&_th]:whitespace-nowrap">
              <tr>
                <th className="eyebrow px-5 py-3 font-normal">상담사</th>
                <th className="eyebrow num px-5 py-3 text-right font-normal">총 상담</th>
                <th className="eyebrow num px-5 py-3 text-right font-normal">상담 완료</th>
                <th className="eyebrow num px-5 py-3 text-right font-normal">등록 완료</th>
                <th className="eyebrow num px-5 py-3 text-right font-normal">전환율</th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {consultants.map((c) => (
                <tr key={c.id} className="hover:bg-accent/40 transition-colors">
                  <td className="text-foreground px-5 py-3 font-medium">{c.name}</td>
                  <td className="text-foreground num px-5 py-3 text-right">{c.total}</td>
                  <td className="text-muted-foreground num px-5 py-3 text-right">{c.consulted}</td>
                  <td className="text-chart-2 num px-5 py-3 text-right">{c.enrolled}</td>
                  <td className="text-foreground num px-5 py-3 text-right font-bold">
                    {c.conversionRate}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: string;
}) {
  return (
    <div className="space-y-1">
      <p className="eyebrow">{label}</p>
      <p className={`text-foreground num text-2xl font-bold ${highlight ?? ""}`}>{value}</p>
    </div>
  );
}
