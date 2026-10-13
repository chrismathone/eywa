"use client";

import { useId, type KeyboardEvent } from "react";
import { TOOLBAR_SEG_BOX_WRAP, TOOLBAR_SEG_ITEM, TOOLBAR_SEG_OFF } from "@/components/toolbar-controls";
import type { ItemId, Metric, StoredPeriod } from "@/features/teacher-portfolio/model/types";
import { closingLabel, dayLabel, fmtScore, itemLabel, itemOf, itemShort, monthName, periodLabel, periodMax, scoreText, shownItems } from "@/features/teacher-portfolio/view";
import type { DetailTarget } from "./detail-dialog";
import { MetricEvidence } from "./evidence-impact";
import type { EvidenceProps } from "./evidence-records";
import { ScoreValue } from "./parts";

const CARD = "bg-card shadow-card min-w-0 rounded-2xl p-5";

/** 그 달에 서는 탭의 항목 — 고른 항목이 그 달에 없으면(설정에서 껐다) 첫 항목. */
export function activeItem(period: StoredPeriod, active: ItemId): Metric | undefined {
  const items = shownItems(period);
  return items.find((m) => m.id === active) ?? items[0];
}

/**
 * 항목별 내역 — 원장이 켠 지표마다 탭 하나. **어느 탭을 눌러도 카드 크기는 그대로**이고 긴 내용은 카드 안에서만 스크롤한다
 * (원장 2026-10-12). 넓은 화면에선 높이가 옆 열(월간 점수·수업·담당 반)에서 온다 — `contain-size`가
 * 이 카드의 내용이 행 높이에 끼어들지 못하게 한다. 한 열로 접히면 높이를 정해 둔다.
 */
export function EvidencePanel({ active, onTab, evidence }: { active: ItemId; onTab: (id: ItemId) => void; evidence: EvidenceProps }) {
  const baseId = useId();
  const items = shownItems(evidence.period);
  const metric = activeItem(evidence.period, active);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!metric) return;
    const at = items.findIndex((m) => m.id === metric.id);
    const last = items.length - 1;
    const next = event.key === "ArrowRight" ? (at + 1) % items.length : event.key === "ArrowLeft" ? (at + last) % items.length
      : event.key === "Home" ? 0 : event.key === "End" ? last : null;
    if (next === null) return;
    event.preventDefault();
    onTab(items[next].id);
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };
  return (
    <section data-evidence-panel className={`${CARD} flex h-[min(45rem,85dvh)] flex-col overflow-hidden lg:h-auto lg:contain-size`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-bold">항목별 내역</h3>
        <span className="num text-xs">{periodLabel(evidence.period)}</span>
      </div>
      <div role="tablist" aria-label="평가 항목" onKeyDown={onKeyDown} className={`${TOOLBAR_SEG_BOX_WRAP} w-fit max-w-full`}>
        {items.map((m) => (
          <button key={m.id} type="button" role="tab" id={`${baseId}-tab-${m.id}`} aria-controls={`${baseId}-panel`} aria-selected={m.id === metric?.id}
            tabIndex={m.id === metric?.id ? 0 : -1} onClick={() => onTab(m.id)}
            className={`${TOOLBAR_SEG_ITEM} ${m.id === metric?.id ? "bg-primary-soft text-primary font-bold" : TOOLBAR_SEG_OFF}`}>
            {itemShort(m)}
          </button>
        ))}
      </div>
      {metric ? (
        <>
          <div className="border-line-faint mt-3 flex items-center justify-between gap-2 border-t pt-3 pb-2.5">
            <h4 className="text-sm font-bold">{itemLabel(metric)}</h4>
            <ScoreValue value={metric.value} max={metric.max} empty={scoreText(metric, evidence.period)} className="text-xl" />
          </div>
          {/* key = 탭이 바뀌면 스크롤이 맨 위에서 시작한다. px-1은 카드 링이 스크롤 경계에서 잘리지 않게. */}
          <div key={metric.id} id={`${baseId}-panel`} role="tabpanel" tabIndex={0} aria-labelledby={`${baseId}-tab-${metric.id}`}
            className="focus-visible:outline-primary -mx-1 min-h-0 flex-1 overflow-auto px-1 pb-1 focus-visible:outline-2">
            <MetricEvidence id={metric.id} {...evidence} sticky />
          </div>
        </>
      ) : <p className="mt-4 text-sm">켜 둔 평가 항목이 없습니다.</p>}
    </section>
  );
}

/** 월간 표의 열 — 가장 최근 달의 차례대로, 그 달에 없던 항목은 뒤에. 이름은 그 항목이 있는 가장 최근 달의 것. */
function monthlyColumns(periods: readonly StoredPeriod[]): Metric[] {
  const columns: Metric[] = [];
  for (const w of periods) for (const m of shownItems(w)) if (!columns.some((c) => c.id === m.id)) columns.push(m);
  return columns;
}

/** 월간 점수 — 총점이 첫 점수 열이다. 기간을 누르면 그 달로, 점수를 누르면 그 달의 근거가 열린다. */
export function MonthlyTable({ periods, selected, onMonth, onOpen }: {
  periods: readonly StoredPeriod[]; selected: string; onMonth: (month: string) => void; onOpen: (month: string, target: DetailTarget) => void;
}) {
  const marked = periods.some((w) => w.items.some((m) => m.estimated));
  const columns = monthlyColumns(periods);
  const cellButton = "text-primary underline underline-offset-4";
  const mark = <sup aria-hidden className="ml-0.5 no-underline">*</sup>;
  return (
    <section className={`${CARD} flex flex-1 flex-col`}>
      <h3 className="text-base font-bold">월간 점수</h3>
      <p className="mt-1 mb-3 text-xs">총점의 만점은 그 달에 켠 항목의 만점 합계입니다. 항목 만점이 지금과 다른 달은 점수 아래에 그 달의 만점을 적습니다. 점수를 누르면 해당 월의 내역이 열립니다.</p>
      {/* 표가 카드의 남는 높이를 나눠 갖는다 — 카드 아래에 빈 띠가 생기지 않는다. */}
      <div className="flex min-h-0 flex-1 overflow-x-auto">
        <table className="num w-full min-w-[32rem] flex-1 border-collapse text-xs [&_td]:whitespace-nowrap">
          <thead>
            <tr className="bg-bg-soft [&_th]:px-1.5 [&_th]:py-2.5 [&_th]:font-bold [&_th]:break-keep">
              <th scope="col" className="text-left">기간</th>
              <th scope="col" className="text-center">총점</th>
              {columns.map((c) => <th key={c.id} scope="col" className="text-center">{itemShort(c)}</th>)}
            </tr>
          </thead>
          <tbody>
            {periods.map((w) => (
              <tr key={w.month} data-selected={w.month === selected || undefined}
                className={`border-line-faint border-b last:border-b-0 [&_td]:px-1.5 [&_td]:py-2.5 ${w.month === selected ? "bg-primary-softer" : ""}`}>
                <td className="text-left whitespace-nowrap">
                  <button type="button" onClick={() => onMonth(w.month)} className={cellButton}>{monthName(w.month)}</button>
                  <small className="mt-1 block text-xs">{w.partial ? `${dayLabel(w.end)}까지` : closingLabel(w)}</small>
                </td>
                <td className="text-center text-sm font-bold">
                  <button type="button" onClick={() => onOpen(w.month, { kind: "ledger" })} aria-label={`${monthName(w.month)} 총점 ${fmtScore(w.total)} / ${periodMax(w)}점`} className={cellButton}>
                    {w.total === null ? "—" : fmtScore(w.total)}
                  </button>
                  {w.items.some((m) => m.estimated) ? mark : null}
                  {w.total !== null && periodMax(w) !== 100 ? <small className="block text-xs font-medium">/ {periodMax(w)}</small> : null}
                </td>
                {columns.map((c) => {
                  const m = itemOf(w, c.id);
                  if (!m || m.off) return <td key={c.id} className="text-center">·</td>;
                  return (
                    <td key={c.id} className="text-center">
                      <button type="button" onClick={() => onOpen(w.month, { kind: "metric", id: c.id })} aria-label={`${monthName(w.month)} ${itemLabel(m)} ${scoreText(m, w)}`} className={cellButton}>
                        {m.value === null ? "—" : fmtScore(m.value)}
                      </button>
                      {m.estimated ? mark : null}
                      {/* 열 머리(가장 최근 달)와 만점이 다른 달 — 구성을 바꾼 앞뒤 달이 한 열에 선다(마감한 달은 그때 구성). */}
                      {m.max !== c.max ? <small className="block text-xs font-medium">/ {m.max > 0 ? m.max : "가감"}</small> : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs leading-relaxed">
        —는 점수가 없는 항목(합계에서 뺐거나 산출불가), ·는 그 달에 없던 항목입니다. 마감한 달은 이후 보충해도 점수가 바뀌지 않습니다.
        {marked ? <><br />* 기록을 시작하기 전인 달입니다. 보고서·출결은 기준 달 평균입니다.</> : null}
      </p>
    </section>
  );
}

export function ClassBox({ classes }: { classes: readonly string[] }) {
  return (
    <section className={CARD}>
      <h3 className="mb-3 text-base font-bold">수업·담당 반</h3>
      {classes.length ? (
        <ul className="flex flex-wrap gap-1.5">
          {classes.map((name) => <li key={name} className="border-line rounded-md border px-2 py-0.5 text-xs">{name}</li>)}
        </ul>
      ) : <p className="text-xs">해당 월 수업이 없습니다.</p>}
      <p className="mt-3 text-xs leading-relaxed">선택한 달의 수강 기간과 시간표 담당을 확인했습니다. 휴원일과 보고서 제외 반은 각 항목의 대상에서 따로 제외합니다.</p>
    </section>
  );
}
