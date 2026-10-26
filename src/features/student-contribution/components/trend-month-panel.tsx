"use client";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { OPERATION_METRICS } from "../model/config";
import type { MonthComparison } from "../model/score-trend";
import { metricLabels, monthStatusClass, monthStatusText, monthText, numberText, signedText } from "./presentation";
import { useDetailTabs } from "./student-detail-tabs";
import { SEGMENT_FILL, type ChartPoint, type SegmentKind } from "./trend-geometry";

const short = (month: string) => `${Number(month.slice(5))}월`;
/** 증감은 색이 아니라 부호와 낱말로 먼저 말한다. 비교하지 않는 까닭도 사실대로 적는다. */
function comparisonText(c: MonthComparison, current: boolean): ReactNode {
  if (c.kind === "change") {
    const word = c.delta >= 0.005 ? "증가" : c.delta <= -0.005 ? "감소" : "유지";
    return <>지난달({short(c.previous)}) {signedText(c.previousChange)}점과 견주면 <strong className="whitespace-nowrap tabular-nums">{word === "유지" ? "같음" : `${signedText(c.delta)}점`} · {word}</strong></>;
  }
  if (c.kind === "open") return <>{current ? "이번 달은 집계 중이라" : "마감 전인 달이라"} 지난달과 견주지 않습니다.
    {c.previous && c.previousChange !== null && <> 지난달({short(c.previous)}) 마감 <span className="tabular-nums">{signedText(c.previousChange)}점</span></>}</>;
  if (c.kind === "missing") return `지난달(${short(c.previous)}) 집계 기록이 없어 견주지 않습니다.`;
  if (c.kind === "previous-open") return `지난달(${short(c.previous)})이 마감 전이라 견주지 않습니다.`;
  if (c.kind === "previous-merged") return `지난달(${short(c.previous)})은 병합 전 원생의 기록이라 견주지 않습니다.`;
  if (c.kind === "first") return "첫 집계 달이라 견줄 지난달이 없습니다.";
  if (c.kind === "merged") return "병합 전 원생의 기록입니다. 이 달 실적은 병합 후 정정으로 반영했습니다.";
  return "이 달은 집계 기록이 없습니다. 누적 선은 앞 달 값을 그대로 이었습니다.";
}

export function TrendMonthPanel({ point, comparison, preview, pending }: { point: ChartPoint; comparison: MonthComparison; preview: boolean; pending: boolean }) {
  const tabs = useDetailTabs(), record = point.hasRecord !== false;
  const status = point.status ?? (record ? "unclosed" : "none"), scored = record && status !== "merged";
  const rows = (point.items ?? []).flatMap((item) => [
    ...(item.value ? [{ key: item.metric, label: metricLabels[item.metric], value: item.value, kind: (OPERATION_METRICS.includes(item.metric) ? "operations" : "participation") as SegmentKind }] : []),
    ...(item.correction ? [{ key: `${item.metric}:correction`, label: `정정 · ${metricLabels[item.metric]}`, value: item.correction, kind: "correction" as SegmentKind }] : []),
  ]).sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const largest = Math.max(1e-9, ...rows.map((r) => Math.abs(r.value)));
  const parts = point.operations === undefined ? [] : ([["운영", "operations", point.operations], ["학습·참여", "participation", point.participation ?? 0], ["정정", "correction", point.correction ?? 0]] as const);
  // 미리보기(마우스·방향키)마다 패널 전체를 다시 읽지 않게, 확정한 달만 알린다.
  return <aside aria-label="선택한 달의 증감" aria-live={preview ? "off" : "polite"} className="min-w-0 border-t border-line p-5 @5xl:border-l @5xl:border-t-0">
    <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-base font-semibold">{monthText(point.month)}{preview ? " 미리보기" : " 선택됨"}</h4>
      <span className={monthStatusClass(status)}>{monthStatusText(status)}</span></div>
    {scored && <><p className="mt-4 text-xs">그 달 증감{status === "current" ? " · 지금까지 집계한 값" : ""}</p>
      <p className="mt-1 flex flex-wrap items-baseline gap-x-2"><strong className="text-3xl font-bold tabular-nums">{signedText(point.change)}</strong><span>점</span>
        <span className="text-sm">{point.change >= 0.005 ? "누적 증가" : point.change <= -0.005 ? "누적 감소" : "변화 없음"}</span></p>
      {!!parts.length && <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">{parts.map(([label, kind, value]) => <div key={kind}>
        <dt className="flex items-center gap-1"><span aria-hidden className="size-2.5 rounded-sm" style={{ background: SEGMENT_FILL[kind] }} />{label}</dt>
        <dd className="mt-0.5 text-sm font-semibold tabular-nums">{signedText(value)}</dd></div>)}</dl>}</>}
    <p className="mt-4 rounded-lg bg-secondary px-3 py-2.5 text-sm leading-relaxed">{comparisonText(comparison, status === "current")}</p>
    <p className="mt-3 text-sm">{monthText(point.month)}까지 누적 <strong className="tabular-nums">{numberText(point.total)}점</strong></p>
    {scored && (rows.length ? <ul className="mt-4 space-y-2.5" aria-label="그 달 항목별 증감">{rows.map((r) => <li key={r.key}>
      <div className="flex items-baseline justify-between gap-3 text-sm"><span>{r.label}</span><span className="font-medium tabular-nums">{signedText(r.value)}점</span></div>
      <div aria-hidden className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full" style={{ width: `${Math.abs(r.value) / largest * 100}%`, background: SEGMENT_FILL[r.kind] }} /></div>
    </li>)}</ul> : <p className="mt-4 text-sm">{status === "closed" && !point.unavailable ? "이 달에 반영된 실적이 없습니다. 실제 0점입니다."
      : status === "closed" ? "확인된 실적은 0점입니다. 확인 전 자료는 반영하지 않았습니다." : "지금까지 반영된 실적이 없습니다. 집계 중이라 바뀔 수 있습니다."}</p>)}
    {scored && !!point.unavailable && <p className="mt-3 text-xs text-amber">확인 전 자료가 있는 항목 {point.unavailable}개 · 확인된 실적만 반영했습니다.</p>}
    <div className="mt-5">{preview ? <p className="text-xs leading-relaxed">{record ? "누르면 이 달을 선택하고 계산 근거도 이 달로 바뀝니다." : "집계 기록이 없는 달은 선택할 수 없습니다."}</p>
      : tabs && <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => tabs.show("evidence", true)}>이 달 계산 근거 보기</Button>}</div>
  </aside>;
}
