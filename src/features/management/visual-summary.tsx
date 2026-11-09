"use client";
import { ChartCard, DonutChart, RankBars, SeriesChart, StatCard } from "@/components/analytics/charts";
import { palette } from "@/components/analytics/chart-math";
import s from "@/components/analytics/analytics.module.css";
import { periodBounds, type ManagementSnapshot } from "./model";

export const featuredMetricIds = ["net_billed", "collected", "active_students", "dual_ratio"];
export function ManagementVisualSummary({ data }: { data: ManagementSnapshot }) {
  const metrics = featuredMetricIds.flatMap(id => data.metrics.filter(m => m.id === id));
  const dual = data.metrics.find(m => m.id === "dual_ratio")?.value;
  const labor = data.reportedFinancials?.financials.labor;
  const laborParts = labor ? [
    { label: "강사 급여", value: labor.instructors },
    { label: "경영팀 급여", value: labor.management },
    { label: "시간제 급여", value: labor.partTime },
    { label: "기타 인건비", value: labor.executives + labor.bonus + labor.retirement + labor.insurance + labor.welfare },
  ] : [];
  return <>
    <div className={s.stats}>{metrics.map((m, i) => <div key={m.id} id={`metric-${m.id}`}>
      <StatCard label={m.label} value={m.value} unit={m.unit} accent={palette[i % 2]} icon={i < 2 ? "money" : "people"} href={m.href} note={i < 2 ? `${data.month} · 청구 기록 기준` : `기준일 ${data.asOf}`}/>
      <details className={s.metricBasis}><summary>산출 근거</summary><p>{m.definition}</p><p>{m.source}</p></details>
    </div>)}</div>
    <div className={s.chartGrid}>
      <ChartCard wide title="청구와 수납, 전월과 비교하기" tag="전월 비교" note="각 월 청구서에 연결된 현재까지의 수납액입니다. 입금일 기준 현금흐름이나 ECOUNT 회계 매출과는 다릅니다." href="/billing/stats">
        <SeriesChart initialMode="bar" unit="원" points={[
          { label: periodBounds(data.month).previous, values: [data.previous.net, data.previous.collected] },
          { label: data.month, values: [data.current.net, data.current.collected] },
        ]} series={[{ label: "실청구", color: palette[0] }, { label: "수납", color: palette[1] }]}/>
      </ChartCard>
      <ChartCard title="영어·수학 동시수강 비중" tag="재원생 기준" note="그 외 수강에는 다른 과목 조합도 포함됩니다. 기준일의 저장된 수강 상태로 계산합니다." href="/students">
        <DonutChart data={dual == null ? [] : [{ label: "영어·수학 동시", value: dual }, { label: "그 외 수강", value: 100 - dual }]} unit="%" center={dual == null ? undefined : `${dual.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}%`} label="영어·수학 동시" showPercent={false}/>
      </ChartCard>
      <ChartCard title="강사별 담당 학생" tag="담당 규모 상위 8명" note="현재 담당 반 기준이며 강사 간 학생은 중복될 수 있습니다. 성과 순위가 아닙니다." href="#people">
        <RankBars data={[...data.teachers].filter(t => t.students > 0).sort((a, b) => b.students - a.students).slice(0, 8).map(t => ({ label: t.label, value: t.students }))} unit="명"/>
      </ChartCard>
      <ChartCard title="상담은 어디에서 왔을까" tag={data.month} note="상담에 기록된 유입경로의 구성입니다. 광고의 순증 효과나 등록 전환율을 뜻하지 않습니다." href="#people">
        <DonutChart data={data.channels.map(c => ({ label: c.label, value: c.inquiries }))} unit="건" label="신규 상담"/>
      </ChartCard>
      <ChartCard title="인건비 구성" tag={data.reportedFinancials?.closed ? "마감 월" : "미마감·입력분"} note="ECOUNT에 입력된 금액의 구성입니다. 미마감 월의 빈 항목은 최종 비용으로 확정할 수 없습니다." href="#accounting">
        <DonutChart data={laborParts} unit="원" label="입력된 인건비"/>
      </ChartCard>
    </div>
  </>;
}
