"use client";
import { useState } from "react";
import { METRICS, OPERATION_METRICS, PARTICIPATION_METRICS, type ContributionConfig, type Metric, type Raws } from "../model/config";
import { scoreRaws, sumRaws } from "../model/calc";
import type { StoredContributionMonth } from "../model/stored";
import { formulaText, metricLabels, monthText, numberText, rawText, rateUnit, signedRawText, signedText } from "./presentation";
import { pendingDetails } from "../model/pending-details";

const cell = "px-4 py-3 text-right tabular-nums align-top";
/** 선택한 달의 원수치·정정과 그 달까지의 누적 원수치에 현재 배점을 곱한 식. 합계는 차트의 막대·누적 점과 같다. */
export function MonthMetrics({ selected, through, config }: { selected: StoredContributionMonth; through: Raws; config: ContributionConfig }) {
  const [showAll, setShowAll] = useState(false);
  const month = sumRaws([selected.raws, selected.correction]), points = scoreRaws(month, config), cumulative = scoreRaws(through, config);
  const meaningful = (id: Metric) => selected.raws[id] !== 0 || selected.correction[id] !== 0 || through[id] !== 0 || selected.unavailable.includes(id);
  const emptyCount = METRICS.filter((id) => !meaningful(id)).length, short = `${Number(selected.month.slice(5))}월까지`;
  const on = (id: Metric) => config.rates[id].enabled;
  const formula = (id: Metric, raw: number) => on(id) && raw !== 0 && <span className="mt-1 block text-xs font-normal">{formulaText(id, raw, config.rates[id].points)}</span>;
  const groups = [OPERATION_METRICS, PARTICIPATION_METRICS].map((all, group) => ({ name: group ? "학습·참여" : "운영 기여", metrics: all.filter((id) => showAll || meaningful(id)),
    month: all.reduce((n, id) => n + points.points[id], 0), cumulative: all.reduce((n, id) => n + cumulative.points[id], 0) })).filter((g) => g.metrics.length);
  const label = (id: Metric) => <><span>{metricLabels[id]}</span><span className="mt-1 block text-xs font-normal">{on(id) ? `${rateUnit(id)} ${numberText(config.rates[id].points)}점` : "평가 제외 항목"}</span>
    {selected.unavailable.includes(id) && <details className="mt-1 text-xs font-normal"><summary className="cursor-pointer text-amber">자료 확인 필요 · 확인된 실적만 반영</summary>{pendingDetails([id], selected.payload.unavailableDetails).map((d) => <p key={d.metric} className="mt-2 max-w-sm leading-relaxed">{d.reason}{d.months.length ? ` 해당 월: ${d.months.join(", ")}` : ""}</p>)}</details>}</>;
  const correction = (id: Metric) => selected.correction[id] !== 0 && <span className="mt-1 block text-xs text-amber">정정 {signedRawText(id, selected.correction[id])}</span>;
  const groupHead = (g: (typeof groups)[number]) => <span className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"><span className="font-semibold text-primary">{g.name}</span>
    <span className="text-xs font-normal tabular-nums">이 달(정정 포함) {signedText(g.month)}점 · 누적 {numberText(g.cumulative)}점</span></span>;
  return <div>{emptyCount > 0 && <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3 text-xs"><span>이 달까지 실적·정정·확인할 자료가 있는 항목을 표시합니다.</span><button type="button" aria-expanded={showAll} onClick={() => setShowAll(!showAll)} className="text-primary underline underline-offset-4">{showAll ? `실적 없는 ${emptyCount}개 항목 접기` : `실적 없는 ${emptyCount}개 항목도 보기`}</button></div>}
    {!groups.length && <p className="px-5 py-6 text-sm">이 달까지 집계된 충성도 실적이 없습니다.</p>}
    {!!groups.length && <div className="overflow-x-auto phone:hidden"><table className="w-full min-w-170 table-fixed text-sm [&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-l-line-faint">
      <colgroup><col className="w-[24%]" /><col className="w-[19%]" /><col className="w-[19%]" /><col className="w-[19%]" /><col className="w-[19%]" /></colgroup>
      <thead className="bg-secondary"><tr><th scope="col" className="px-4 py-3 text-left font-medium">평가 항목 · 배점</th>
        {["이 달 실적", "이 달 점수", `${short} 누적 실적`, `${short} 누적 점수`].map((text) => <th key={text} scope="col" className="px-4 py-3 text-right font-medium">{text}</th>)}</tr></thead>
      {groups.map((g) => <tbody key={g.name}><tr className="border-t border-line"><th colSpan={5} scope="colgroup" className="px-4 pb-2 pt-4 text-left">{groupHead(g)}</th></tr>
        {g.metrics.map((id) => <tr key={id} className="border-t border-line-faint">
          <th scope="row" className="px-4 py-3 text-left align-top font-medium">{label(id)}</th>
          <td className={cell}>{rawText(id, selected.raws[id])}{correction(id)}</td>
          <td className={`${cell} font-semibold`}>{on(id) ? `${signedText(points.points[id])}점` : "평가 제외"}{formula(id, month[id])}</td>
          <td className={cell}>{rawText(id, through[id])}</td>
          <td className={`${cell} font-semibold`}>{on(id) ? `${numberText(cumulative.points[id])}점` : "평가 제외"}{formula(id, through[id])}</td>
        </tr>)}</tbody>)}</table></div>}
    {groups.map((g) => <section key={g.name} aria-label={g.name} className="hidden border-t border-line px-4 py-3 phone:block">{groupHead(g)}
      <ul className="mt-2 divide-y divide-line-faint">{g.metrics.map((id) => <li key={id} className="py-3 text-sm"><div className="font-medium">{label(id)}</div>
        <dl className="mt-2 grid grid-cols-2 gap-3 text-xs tabular-nums">
          <div><dt>이 달</dt><dd className="mt-0.5 text-sm">{rawText(id, selected.raws[id])}{correction(id)}</dd><dd className="mt-0.5 text-sm font-semibold">{on(id) ? `${signedText(points.points[id])}점` : "평가 제외"}</dd></div>
          <div><dt>{short} 누적</dt><dd className="mt-0.5 text-sm">{rawText(id, through[id])}</dd><dd className="mt-0.5 text-sm font-semibold">{on(id) ? `${numberText(cumulative.points[id])}점` : "평가 제외"}</dd></div>
        </dl></li>)}</ul></section>)}
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-t border-line bg-primary-softer px-5 py-3 text-sm">
      <span>{monthText(selected.month)}에 반영된 점수 <span className="text-xs">(정정 포함)</span> <strong className="ml-1 text-lg tabular-nums">{signedText(points.total)}점</strong></span>
      <span>{monthText(selected.month)}까지 누적 <strong className="ml-1 text-lg text-primary tabular-nums">{numberText(cumulative.total)}점</strong></span>
    </div></div>;
}
