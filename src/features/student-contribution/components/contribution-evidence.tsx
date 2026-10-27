import { scoreRaws } from "../model/calc";
import type { ContributionConfig, Raws } from "../model/config";
import type { TrendPoint } from "../model/score-trend";
import type { DisplayContributionMonth } from "../server/student-months";
import type { DisplaySignal } from "../server/signal-display";
import { TONE_SOFT } from "@/lib/design/semantic-color";
import { ContributionMonthPicker } from "./month-picker";
import { MonthMetrics } from "./month-metrics";
import { CorrectionDetails } from "./correction-details";
import { FactsTable } from "./facts-table";
import { SignalControls } from "./signal-controls";
import { VideoCompletionCheck } from "./video-completion-check";
import { metricLabels, monthStatusClass, monthStatusText, monthText, numberText, signedRawText, signedText, sourceLabels } from "./presentation";

const statusNote: Record<TrendPoint["status"], string> = {
  closed: "마감한 달의 실적은 보존합니다. 이후 환불·소개 연결·병합·판정 변경은 그때의 이번 달 정정으로 반영합니다.",
  current: "이번 달은 집계 중입니다. 다음 집계 때 실적과 근거가 바뀔 수 있습니다.",
  unclosed: "아직 마감하지 않은 달입니다. 다음 집계 때 실적과 근거가 바뀔 수 있습니다.",
  merged: "병합 전 학생의 기록입니다. 실적은 병합 후 정정에 반영했습니다.", none: "",
};
const chip = "inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium";

/** 추이 탭의 막대·누적 점과 같은 달·같은 원수치로 계산식을 펼친다. 선택한 달의 근거만 읽은 결과다. */
export function ContributionEvidence({ selected, months, through, point, config, withheld, signals, canWrite, studentId }: {
  selected: DisplayContributionMonth; months: string[]; through: Raws; point: TrendPoint; config: ContributionConfig;
  withheld: number; signals: DisplaySignal[]; canWrite: boolean; studentId: string;
}) {
  const { facts, coverage, correctionReasons, corrections } = selected.payload;
  const ready = coverage.filter((c) => c.state === "ready").length, fix = scoreRaws(selected.correction, config);
  const stats: [string, string, string][] = [
    ["그 달 증감", `${signedText(point.change)}점`, `운영 ${signedText(point.operations)} · 학습 ${signedText(point.participation)} · 정정 ${signedText(point.correction)}`],
    [`${Number(selected.month.slice(5))}월까지 누적`, `${numberText(point.total)}점`, "현재 배점으로 다시 계산"],
    ["근거 기록", `${facts.length.toLocaleString("ko-KR")}건`, withheld ? `원문·학생 연결을 확인할 수 없는 ${withheld}건은 표시하지 않음` : facts.length ? "원본 기록 링크 제공" : "이 달 근거 기록 없음"],
    ["자료 확인", coverage.length ? `${ready} / ${coverage.length} 출처` : "범위 기록 없음", selected.unavailable.length ? `확인 전 자료가 있는 항목 ${selected.unavailable.length}개 · 확인된 실적만 반영`
      : ready < coverage.length ? "일부 출처는 추가 확인 중 · 아래 자료 범위 참고" : "모든 출처 확인됨"],
  ];
  return <>
    <section className="@container overflow-hidden rounded-xl border border-line" aria-labelledby="contribution-evidence-title">
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4"><div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2"><h3 id="contribution-evidence-title" className="font-semibold">{monthText(selected.month)} 계산 근거</h3>
          <span className={monthStatusClass(point.status)}>{monthStatusText(point.status)}</span>{selected.reconstructed && <span className={`${chip} ${TONE_SOFT.special}`}>과거 자료로 복원</span>}</div>
        <p className="mt-1 text-xs leading-relaxed">{statusNote[point.status]}</p></div>
        <ContributionMonthPicker month={selected.month} months={months} /></div>
      <dl className="grid grid-cols-2 border-t border-line @4xl:grid-cols-4">{stats.map(([label, value, note], i) => <div key={label} className={`min-w-0 px-5 py-4 ${i % 2 ? "border-l border-line" : ""} ${i > 1 ? "border-t border-line @4xl:border-t-0" : ""} ${i === 2 ? "@4xl:border-l" : ""}`}>
        <dt className="text-xs">{label}</dt><dd className="mt-1 text-xl font-bold tabular-nums">{value}</dd><dd className="mt-1 text-xs leading-relaxed">{note}</dd></div>)}</dl>
      <MonthMetrics key={selected.month} selected={selected} through={through} config={config} />
      {!!correctionReasons.length && <div className="border-t border-line px-5 py-4 text-sm"><h4 className="font-semibold">이 달에 들어온 정정 {correctionReasons.length}개 항목</h4>
        <p className="mt-1 text-xs leading-relaxed">마감한 달의 원본 기록이 바뀐 만큼을 이 달에 더하거나 뺐습니다. 음수는 누적에서 빠진 값입니다.</p>
        <ul className="mt-3 space-y-1.5">{correctionReasons.map((r) => <li key={r.metric} className="flex flex-wrap items-baseline justify-between gap-x-4"><span>{metricLabels[r.metric]} <span className="tabular-nums">{signedRawText(r.metric, r.delta)}</span></span>
          <strong className="tabular-nums text-amber">{signedText(fix.points[r.metric])}점</strong></li>)}</ul>
        {!!corrections?.length && <details className="mt-3 text-xs"><summary className="cursor-pointer text-sm font-medium">원래 달별 변경 내역</summary><CorrectionDetails key={selected.month} entries={corrections} studentId={studentId} /></details>}</div>}
    </section>
    {selected.month >= "2026-01" && <VideoCompletionCheck key={`${studentId}:${selected.month}`} studentId={studentId} month={selected.month} />}
    <section className="overflow-hidden rounded-xl border border-line"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4"><div><h3 className="font-semibold">{monthText(selected.month)} 근거 기록</h3>
      <p className="mt-1 text-xs">기록을 골라 원본을 확인할 수 있습니다. {selected.closedAt ? "마감 당시 확인한 자료입니다." : "최근 집계에서 확인한 자료입니다."}{facts.some(f => f.kind === "parent_event") && " 설명회 근거는 최근 확인 상태이며, 뒤늦게 연결한 실적은 연결 후 집계한 달의 정정에 반영됩니다."}</p></div><span className="rounded-full bg-secondary px-3 py-1 text-xs tabular-nums">{facts.length}건</span></div>
      <FactsTable key={selected.month} facts={facts} canInspectParentEvents={canWrite} /></section>
    <section className="@container rounded-xl border border-line"><div className="border-b border-line px-5 py-4"><h3 className="font-semibold">자료 범위와 확인 상태</h3>
      <p className="mt-1 text-xs">{coverage.length ? `${coverage.length}개 출처 중 ${ready}개 확인 · 확인 전 출처는 확인된 실적만 점수에 반영합니다.` : "이 달의 자료 범위 기록이 없습니다."}</p></div>
      {!!coverage.length && <ul className="grid gap-x-6 gap-y-4 p-5 @2xl:grid-cols-2 @5xl:grid-cols-3">{coverage.map((c) => <li key={c.source} className="min-w-0 space-y-1 text-xs">
        <p className="flex items-center justify-between gap-2 text-sm font-medium">{sourceLabels[c.source]}<span className={`${chip} ${TONE_SOFT[c.state === "ready" ? "positive" : "caution"]}`}>{c.state === "ready" ? "확인됨" : "확인 전"}</span></p>
        <p className="tabular-nums">{c.from ?? "기록 없음"} ~ {c.through ?? "—"}</p>{c.note && <p className="leading-relaxed">{c.note}</p>}</li>)}</ul>}
    </section>
    <details className="rounded-xl border border-line"><summary className="cursor-pointer px-5 py-4 font-semibold">긍정 신호 판정 <span className="ml-2 text-sm font-normal">{signals.length}건 · 전체 기간</span></summary><div className="border-t border-line p-5"><SignalControls signals={signals} canWrite={canWrite} /></div></details>
  </>;
}
