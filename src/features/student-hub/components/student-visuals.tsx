import { ChartCard, DonutChart, RankBars, SeriesChart, StatCard } from "@/components/analytics/charts";
import { palette } from "@/components/analytics/chart-math";
import s from "@/components/analytics/analytics.module.css";
import type { getStudentHub } from "../server/query";

type Hub = NonNullable<Awaited<ReturnType<typeof getStudentHub>>>;
export function StudentVisuals({ data }: { data: Hub }) {
  const base = `/students/${data.student.id}`;
  const current = data.monthly.find(m => m.month === data.month);
  const section = (key: string) => data.sections.find(s => s.key === key);
  const total = (key: string) => {
    const found = section(key);
    return found && ["ready", "partial"].includes(found.state) ? found.total : null;
  };
  // Calendar gaps remain unknown instead of being drawn as zero or connected across.
  const months = Array.from({ length: 12 }, (_, i) => {
    const [year, month] = data.month.split("-").map(Number);
    return new Date(Date.UTC(year, month - 12 + i, 1)).toISOString().slice(0, 7);
  });
  const points = months.map(month => {
    const row = data.monthly.find(m => m.month === month);
    return { label: month.slice(2).replace("-", "."), values: row ? [row.operations, row.participation] : [null, null], partial: row?.partial };
  });
  const states = [{ label: "연결됨", states: ["ready"], color: palette[1] }, { label: "일부 확인", states: ["partial", "stale"], color: palette[2] }, { label: "준비·확인 필요", states: ["pending", "empty", "failed", "schema_missing", "unavailable"], color: palette[0] }, { label: "제한·미사용", states: ["forbidden", "off"], color: palette[5] }];
  const coverage = states.map(g => ({ label: g.label, value: data.coverage.filter(c => g.states.includes(c.state)).length, color: g.color })).filter(g => g.value > 0);
  const records = ["progress", "consultations", "memos", "grades", "billing"].flatMap(key => {
    const count = total(key), item = section(key);
    return count !== null && item ? [{ label: item.label, value: count }] : [];
  }).sort((a, b) => b.value - a.value);
  return <>
    <div className={s.stats}>
      <StatCard label="현재 수강" value={total("classes")} unit="건" note="현재 연결된 수업 기준" icon="people" href={`${base}?tab=classes`}/>
      <StatCard label="운영·참여 합산 점수" value={current?.total ?? null} unit="점" note={`${data.month} · ${current?.partial ? "일부 자료 기준" : "현재 배점 적용"}`} accent={palette[1]} href={`${base}?tab=contribution&month=${data.month}`}/>
      <StatCard label="수업·진도 기록" value={total("progress")} unit="건" note="연결된 진도·보고 기록" accent={palette[2]} icon="record" href={section("progress")?.href}/>
      <StatCard label="상담 기록" value={total("consultations")} unit="건" note="연결된 상담 이력" accent={palette[3]} icon="record" href={section("consultations")?.href}/>
    </div>
    <div className={s.chartGrid}>
      <ChartCard wide title="학생의 활동 흐름" kicker="MONTHLY ACTIVITY" tag="최근 12개월" note="선택 월까지의 기록을 현재 배점으로 계산했습니다. 빈 구간은 미확인 자료이며, 점수는 퇴원 확률을 뜻하지 않습니다." href={`${base}?tab=contribution&month=${data.month}`}>
        <SeriesChart points={points} series={[{ label: "운영 기여", color: palette[0] }, { label: "학습·참여", color: palette[1] }]}/>
      </ChartCard>
      <ChartCard title="활동 점수 구성" kicker="ACTIVITY MIX" tag={data.month} note={current?.partial ? "확인된 일부 실적의 점수 비중입니다." : "운영 기여·학습 참여 점수의 구성입니다."}>
        <DonutChart data={current ? [{ label: "운영 기여", value: current.operations }, { label: "학습·참여", value: current.participation }] : []} unit="점" label="활동 점수"/>
      </ChartCard>
      <ChartCard wide title="학생에게 연결된 기록" kicker="STUDENT RECORDS" tag="원본별 건수" note="각 원본의 조회 범위가 다릅니다. 월간 실적 비교가 아닌, 학생에게 연결된 기록의 규모입니다.">
        <RankBars data={records}/>
      </ChartCard>
      <ChartCard title="자료 연결 현황" kicker="DATA COVERAGE" note="자료 영역의 연결 상태입니다. 학생의 성취도나 위험도를 나타내는 비율이 아닙니다." href="#student-hub-coverage">
        <DonutChart data={coverage} unit="개" label="자료 영역"/>
      </ChartCard>
    </div>
  </>;
}
