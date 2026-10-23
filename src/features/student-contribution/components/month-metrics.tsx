import { METRICS, type ContributionConfig, type Raws } from "../model/config";
import { scoreRaws, sumRaws } from "../model/calc";
import type { StoredContributionMonth } from "../model/stored";
import { metricLabels, numberText, rawText, rateUnit } from "./presentation";
import { pendingDetails } from "../model/pending-details";

export function MonthMetrics({ selected, total, config }: { selected: StoredContributionMonth; total: Raws; config: ContributionConfig }) {
  const points = scoreRaws(sumRaws([selected.raws, selected.correction]), config);
  return <div className="overflow-x-auto"><table className="w-full min-w-150 table-fixed text-sm"><colgroup><col className="w-[34%]" /><col className="w-[22%]" /><col className="w-[20%]" /><col className="w-[24%]" /></colgroup><thead className="bg-secondary text-left"><tr>
    <th className="px-5 py-3 font-medium">평가 항목</th><th className="px-5 py-3 text-right font-medium">이 달 실적</th><th className="px-5 py-3 text-right font-medium">이 달 점수</th><th className="px-5 py-3 text-right font-medium">누적 실적</th>
  </tr></thead>{[METRICS.slice(0, 5), METRICS.slice(5)].map((metrics, group) => <tbody key={group}>
    <tr className="border-b border-line"><th colSpan={4} className="px-5 pb-2 pt-5 text-left font-semibold text-primary">{group === 0 ? "운영 기여" : "학습·참여"}</th></tr>
    {metrics.map((id) => <tr key={id} className="border-b border-line-faint last:border-0">
      <th className="px-5 py-3 text-left font-medium"><span>{metricLabels[id]}</span><span className="mt-1 block text-xs font-normal">{rateUnit(id)} {numberText(config.rates[id].points)}점</span>
        {selected.unavailable.includes(id) && <details className="mt-1 text-xs font-normal"><summary className="cursor-pointer">자료 확인이 필요한 이유</summary>{pendingDetails([id], selected.payload.unavailableDetails).map(d => <p key={d.metric} className="mt-2 max-w-sm leading-relaxed">{d.reason}{d.months.length ? ` 해당 월: ${d.months.join(", ")}` : ""}</p>)}</details>}</th>
      <td className="px-5 py-3 text-right tabular-nums">{rawText(id, selected.raws[id])}{selected.correction[id] !== 0 && <span className="mt-1 block text-xs">정정 {selected.correction[id] > 0 ? "+" : ""}{rawText(id, selected.correction[id])}</span>}</td>
      <td className="px-5 py-3 text-right font-semibold tabular-nums">{config.rates[id].enabled ? `${numberText(points.points[id])}점` : "평가 제외"}</td>
      <td className="px-5 py-3 text-right tabular-nums">{rawText(id, total[id])}</td>
    </tr>)}
  </tbody>)}</table></div>;
}
