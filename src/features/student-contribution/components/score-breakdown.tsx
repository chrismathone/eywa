import { METRICS, type ContributionConfig, type Raws } from "../model/config";
import { scoreRaws } from "../model/calc";
import { metricLabels, numberText, rawText } from "./presentation";

export function ScoreBreakdown({ raws, config, preview = false }: { raws: Raws; config: ContributionConfig; preview?: boolean }) {
  const score = scoreRaws(raws, config);
  const rows = METRICS.filter((id) => score.points[id] !== 0).sort((a, b) => score.points[b] - score.points[a]);
  const largest = Math.max(1, ...rows.map((id) => Math.abs(score.points[id])));
  return <section className="min-w-0 rounded-xl border border-line bg-card p-5"><h3 className="font-semibold">점수는 어떻게 구성되나요?</h3>
    <p className="mt-1 text-xs leading-relaxed">누적 실적 × {preview ? "입력한" : "현재"} 배점입니다. 막대는 항목별 점수 크기를 비교하며 만점이나 상한을 뜻하지 않습니다.</p>
    {rows.length ? <ul className="mt-5 space-y-4">{rows.map((id) => <li key={id}>
      <div className="flex items-center justify-between gap-3 text-sm"><span>{metricLabels[id]}</span><strong className="tabular-nums">{numberText(score.points[id])}점</strong></div>
      <div className="my-2 h-1.5 overflow-hidden rounded-full bg-secondary" aria-hidden="true"><div className={`h-full rounded-full ${score.points[id] < 0 ? "bg-amber" : "bg-primary"}`} style={{ width: `${Math.abs(score.points[id]) / largest * 100}%` }} /></div>
      <p className="text-xs leading-relaxed">{rawText(id, raws[id])}{id === "tuitionWon" ? " ÷ 100,000원" : ""} × {numberText(config.rates[id].points)}점{id === "tenureYears" ? " (재원 12개월마다 1회)" : ""}</p>
    </li>)}</ul> : <p className="py-12 text-center text-sm">아직 반영된 기여도 점수가 없습니다.</p>}
    <div className="mt-5 flex items-center justify-between border-t border-line pt-3 text-sm"><span>누적 기여도</span><strong className="text-primary tabular-nums">{numberText(score.total)}점</strong></div>
  </section>;
}
