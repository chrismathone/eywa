import { EmbedLink as Link } from "@/components/embed-link";
import { getContributionStudent } from "../server/student-query";
import { sumRaws, scoreRaws } from "../model/calc";
import { shiftMonth } from "@/lib/date-kst";
import { EyIcon } from "@/components/icons/aywa-icons";
import { FactsTable } from "./facts-table";
import { SignalControls } from "./signal-controls";
import { ContributionHeader } from "./contribution-shell";
import { ContributionMonthPicker } from "./month-picker";
import { ScoreTrend, type TrendPoint } from "./score-trend";
import { ScoreBreakdown } from "./score-breakdown";
import { MonthMetrics } from "./month-metrics";
import { CorrectionDetails } from "./correction-details";
import { metricLabels, numberText, monthText, rawText, sourceLabels } from "./presentation";

export async function ContributionStudentPanel({ studentId, month }: { studentId: string; month?: string }) {
  const data = await getContributionStudent(studentId, month);
  if (!data) return <p>기여도 기록을 열람할 수 없습니다.</p>;
  if (!data.ready || !data.months.length) return <div className="w-full space-y-5"><ContributionHeader title={`${data.student.name}의 기여도`} description="학생의 기록을 바탕으로 기여도를 확인합니다." active="students" />
    <div className="rounded-xl border border-line p-12 text-center"><p className="font-semibold">아직 집계된 기록이 없습니다.</p><p className="mt-2 text-sm">첫 집계가 끝나면 점수와 계산 근거가 표시됩니다.</p><Link href="/student-contribution" className="mt-5 inline-block text-sm text-primary underline">원생 기여도 목록으로</Link></div></div>;
  const total = sumRaws(data.months.flatMap((m) => [m.raws, m.correction])), config = data.settings.config, scored = scoreRaws(total, config);
  const selected = data.months.find((m) => m.month === month) ?? data.months.at(-1)!;
  const monthlyScore = scoreRaws(sumRaws([selected.raws, selected.correction]), config).total;
  const byMonth = new Map(data.months.map((m) => [m.month, scoreRaws(sumRaws([m.raws, m.correction]), config).total]));
  const trend: TrendPoint[] = []; let cumulative = 0;
  for (let m = data.months[0]!.month; m <= data.months.at(-1)!.month; m = shiftMonth(m, 1)) {
    const change = byMonth.get(m) ?? 0; cumulative += change; trend.push({ month: m, total: cumulative, change, corrected: !!data.months.find((row) => row.month === m)?.payload.correctionReasons.length });
  }
  const latest = data.months.at(-1)!;
  const pending = latest.unavailable.length;
  return <div className="w-full min-w-0 space-y-5 pb-6">
    <ContributionHeader title={`${data.student.name}의 기여도`} description="얼마나 쌓였는지, 어떤 기록에서 나온 점수인지 함께 확인하세요." active="students" canConfigure={data.gate.canConfigure}
      actions={<Link href="/student-contribution" className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-2 text-sm hover:bg-muted"><EyIcon name="chevronLeft" size={16} />원생 목록</Link>} />
    <section className="grid grid-cols-[1.2fr_1fr_1fr] overflow-hidden rounded-xl border border-line phone:grid-cols-1" aria-label="누적 기여도 요약">
      <div className="bg-primary px-6 py-5 text-primary-foreground"><h2 className="text-sm font-medium">누적 기여도</h2><p className="mt-2 text-4xl font-bold tracking-tight tabular-nums">{numberText(scored.total)}<span className="ml-2 text-base font-normal">점</span></p><p className="mt-3 text-xs">현재 배점 기준 · 점수 상한 없음</p></div>
      {[["운영 기여", scored.operations, "소개 · 수업료 · 수강 기간"], ["학습·참여", scored.participation, "출결 · 영상 숙제 · 평가 · 긍정 신호"]].map(([label, value, note]) => <div key={label} className="border-l border-line px-6 py-5 phone:border-l-0 phone:border-t"><h2 className="text-sm font-medium">{label}</h2><p className="mt-3 text-2xl font-bold tabular-nums">{numberText(Number(value))}<span className="ml-1 text-sm font-normal">점</span></p><p className="mt-3 text-xs">{note}</p></div>)}
    </section>
    {!!pending && <p className="rounded-lg bg-primary-softer px-4 py-3 text-sm">{pending}개 항목은 확인하지 못한 자료가 있어 현재 확인된 실적만 반영했습니다. 월별 내역에서 확인할 수 있습니다.</p>}
    <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] items-start gap-5 phone:grid-cols-1"><ScoreTrend points={trend} studentId={studentId} /><ScoreBreakdown raws={total} config={config} /></div>
    <section id="monthly" className="scroll-mt-5 overflow-hidden rounded-xl border border-line">
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-5"><div className="space-y-2"><h3 className="font-semibold">월별 내역</h3><p className="text-xs">{!selected.computedAt ? "병합 전 학생의 기록 · 실적은 병합 후 정정에 반영" : selected.closedAt ? "마감된 기록" : "이번 달 기록 · 다음 집계 때 갱신"}{selected.reconstructed ? " · 과거 자료로 복원" : ""}</p></div><ContributionMonthPicker month={selected.month} months={data.months.map((m) => m.month)} /></div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-primary-softer px-5 py-3 text-sm"><span>{monthText(selected.month)}에 반영된 점수 <span className="text-xs">(정정 포함)</span></span><strong className="text-lg text-primary tabular-nums">{numberText(monthlyScore)}점</strong></div>
      <MonthMetrics selected={selected} total={total} config={config} />
      <div className="border-t border-line px-5 py-4 text-xs leading-relaxed"><p>마감한 달의 실적은 보존합니다. 이후 환불·소개 연결·병합·판정 변경은 이번 달 정정으로 반영합니다.</p>
        {!!selected.payload.correctionReasons.length && <details className="mt-3"><summary className="cursor-pointer text-sm font-medium">정정 내역 {selected.payload.correctionReasons.length}개 항목</summary>
          <ul className="mt-3 space-y-2">{selected.payload.correctionReasons.map((r) => <li key={r.metric}>{metricLabels[r.metric]}: {r.delta > 0 ? "+" : ""}{rawText(r.metric, r.delta)}<p className="mt-1">마감 이후 원본 기록의 변경을 반영한 차이입니다.</p></li>)}</ul>
          {!!selected.payload.corrections?.length && <CorrectionDetails key={selected.month} entries={selected.payload.corrections} studentId={studentId} />}
        </details>}
      </div>
    </section>
    <section className="overflow-hidden rounded-xl border border-line"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4"><div><h3 className="font-semibold">{monthText(selected.month)}의 기록</h3><p className="mt-1 text-xs">기록을 골라 원본을 확인할 수 있습니다. {selected.closedAt ? "마감 당시 확인한 자료입니다." : "최근 집계에서 확인한 자료입니다."}</p></div><span className="rounded-full bg-secondary px-3 py-1 text-xs">{selected.payload.facts.length}건</span></div><FactsTable key={selected.month} facts={selected.payload.facts} /></section>
    <details className="rounded-xl border border-line"><summary className="cursor-pointer px-5 py-4 font-semibold">긍정 신호 판정 <span className="ml-2 text-sm font-normal">{data.signals.length}건 · 전체 기간</span></summary><div className="border-t border-line p-5"><SignalControls signals={data.signals} canWrite={data.gate.canWrite} /></div></details>
    <details className="rounded-xl border border-line"><summary className="cursor-pointer px-5 py-4 text-sm font-medium">자료 범위와 확인 상태</summary><ul className="grid grid-cols-2 gap-4 border-t border-line p-5 phone:grid-cols-1">{selected.payload.coverage.map((c) => <li key={c.source} className="space-y-2 text-xs"><p className="text-sm font-medium">{sourceLabels[c.source]} <span className="ml-2 text-xs font-normal">{c.state === "ready" ? "확인됨" : "확인 전"}</span></p><p>{c.from ?? "기록 없음"} ~ {c.through ?? "—"}</p>{c.note && <p className="leading-relaxed">{c.note}</p>}</li>)}</ul></details>
  </div>;
}
