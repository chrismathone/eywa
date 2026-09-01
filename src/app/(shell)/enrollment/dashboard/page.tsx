import Link from "next/link";
import { TOOLBAR_CHIP, TOOLBAR_CHIP_OFF, TOOLBAR_CHIP_ON } from "@/components/toolbar-controls";
import { BackLink } from "@/components/back-link";
import { requireAccess } from "@/lib/auth/require-access";
import {
  getConsultantPerformance,
  getMonthlyConversionTrend,
  getMonthlyOutcomeDistribution,
  getConsultationMinYear,
} from "@/features/enrollment/server/queries";
import { ConversionBars } from "./_components/conversion-bars";
import { OutcomeDonut } from "./_components/outcome-donut";
import { kstMonth } from "@/lib/date-kst";

export const metadata = { title: "등록상담 대시보드 — eywa" };

function currentMonthKey(): string {
  return kstMonth();
}

/**
 * 월 선택지. 🔴 6개월 고정이었다(원장 2026-08-05 지적: "왜 26.03~26.08 뿐이지? 데이터가 더 많을텐데").
 * 옛 콜앤상담 이관으로 2023-01까지 생겼는데 화면은 최근 6개월만 고르게 해 그 앞이 없는 것처럼 보였다.
 * 이제 **데이터가 있는 가장 이른 달**까지 만든다(없는 달을 고르면 빈 화면으로 걸어 들어가므로 상한도 둔다).
 */
function monthOptions(count: number): { key: string; label: string }[] {
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

  // 추세 창 = 당월부터 데이터가 있는 가장 이른 달까지(최대 36개월). 6개월 고정이 원장 지적의 원인이었다.
  const minYear = await getConsultationMinYear();
  const [ny, nm] = kstMonth().split("-").map(Number);
  const monthsBack = Math.min(36, Math.max(6, (ny! - minYear) * 12 + nm!));

  const [distribution, trend, consultants] = await Promise.all([
    getMonthlyOutcomeDistribution(selectedMonth),
    getMonthlyConversionTrend(monthsBack),
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
      {/* ⚠️ 툴바엔 카드 껍데기를 두지 않는다 — 칩이 저마다 테두리를 갖고 있어 줄은 그대로 읽힌다. */}
      <div className="flex flex-wrap items-center gap-1.5 px-1 py-1">
        <span className="micro shrink-0">월 선택</span>
        {monthOptions(monthsBack).map((m) => (
          <Link
            key={m.key}
            href={`/enrollment/dashboard?month=${m.key}`}
            className={`${TOOLBAR_CHIP} ${selectedMonth === m.key ? TOOLBAR_CHIP_ON : TOOLBAR_CHIP_OFF}`}
          >
            {m.label}
          </Link>
        ))}
      </div>

      {/* Stats KPI */}
      <section className="bg-card border-border grid grid-cols-2 gap-4 rounded-2xl border p-5 sm:grid-cols-3">
        <Stat label="전체 상담" value={`${monthTotal}건`} />
        {/* "등록 완료"였다 — 값은 상담 결과(outcome) 기준이라 반 배정과 별개다. 보드 헤더는 같은 이유로
            이미 이 지표를 버리고 "반 배정 완료"를 쓴다(page.tsx 주석). 라벨로 잣대를 밝힌다. */}
        <Stat label="재원생 등록(상담 결과)" value={`${monthEnrolled}건`} highlight="text-chart-2" />
        <Stat label="등록 결정률" value={`${monthlyRate}%`} highlight="text-chart-1" />
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="bg-card border-border rounded-2xl border p-5">
          <header className="mb-3">
            <h2 className="text-foreground text-sm font-bold">월별 상태 분포</h2>
            <p className="text-muted-foreground text-xs">{selectedMonth} 기준 상담 상태별 건수</p>
          </header>
          <OutcomeDonut data={distribution} />
        </section>

        <section className="bg-card border-border rounded-2xl border p-5">
          <header className="mb-3">
            <h2 className="text-foreground text-sm font-bold">최근 6개월 전환율</h2>
            <p className="text-muted-foreground text-xs">상담 완료율(상담완료 · AI 완료 · 재원생 등록 포함) / 등록 결정률</p>
          </header>
          <ConversionBars data={trend} />
        </section>
      </div>

      <section className="bg-card border-border rounded-2xl border">
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
                <th className="eyebrow num px-5 py-3 text-right font-normal">재원생 등록</th>
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
