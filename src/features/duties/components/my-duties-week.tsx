"use client";

import type { DutyItemView } from "../kinds";
import { DUTY_LEDGER_START, buildDutyCards, groupCardsByClass, type DutyWeekCell } from "../view";

/**
 * '이번 주' 보기 — 반별 표: 줄 = 학생, 칸 = 그날 그 학생 의무(출결·보고서·발송) 중 **완료한 건수/전체**. 일간을 7일로 접은 창이다(주 단위 의무는 없다 — 결정 2026-11-09).
 * 수업이 없던 날·장부가 쌓이기 전 날은 빈 칸으로 두고 까닭을 적는다(원장 2026-11-09 *"왜 100%인지 뭘 원하는지"* — 비율 하나로는 안 읽힌다).
 */
export function MyDutiesWeek({ items, week, days, now }: { items: DutyItemView[]; week: DutyWeekCell[]; days: string[]; now: number }) {
  const groups = groupCardsByClass(buildDutyCards(items, week, days, now), now);
  const totals = days.map((d) => week.filter((w) => w.day === d).reduce((a, w) => ({ total: a.total + w.total, done: a.done + w.done }), { total: 0, done: 0 }));
  const md = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;
  const DOW = ["일", "월", "화", "수", "목", "금", "토"];
  const dow = (ymd: string) => DOW[new Date(Date.parse(`${ymd}T00:00:00Z`)).getUTCDay()] ?? "";
  const beforeLedger = days.filter((d) => d < DUTY_LEDGER_START).length;
  if (!groups.length) return <p className="text-text-dim mt-2 text-sm">오늘 의무가 있는 학생이 없어 주간 표를 그릴 수 없습니다.</p>;
  return <div>
    <p className="text-text-dim mb-2 text-xs">칸 = 그날 그 학생의 할 일(출결 · 보고서 · 발송) 중 끝낸 수 / 전체. 초록 = 다 함 · 주황 = 일부 · 빨강 = 하나도 안 함 · 빈 칸 = 그날 수업 없음.
      {beforeLedger ? ` 장부는 ${md(DUTY_LEDGER_START)}부터 쌓여 그 전 날은 '기록 전'입니다.` : ""}</p>
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-xs">
        <thead>
          <tr className="text-text-dim">
            <th className="px-2 py-1.5 text-left font-semibold">학생</th>
            {days.map((d, i) => <th key={d} className={`px-1 py-1.5 text-center font-semibold whitespace-nowrap ${i === days.length - 1 ? "text-foreground" : ""}`}>{md(d)} <span className="font-medium">{dow(d)}</span></th>)}
          </tr>
        </thead>
        <tbody>
          {groups.flatMap((g) => [
            <tr key={`g-${g.classId ?? "none"}`} className="bg-bg-soft">
              <td colSpan={days.length + 1} className="px-2 py-1 text-xs font-bold">{g.name}<span className="text-text-dim ml-2 font-medium tabular-nums">오늘 {g.done}/{g.total}{g.late ? <span className="text-danger"> · 기한 초과 {g.late}</span> : null}</span></td>
            </tr>,
            ...g.cards.map((c) => <tr key={c.key} className="border-line-faint border-t">
              <td className="px-2 py-1 pl-4 font-bold whitespace-nowrap">{c.title}</td>
              {c.weekCounts.map((r, i) => <td key={i} className="px-1 py-1 text-center">
                {r ? <span className={`inline-block min-w-11 rounded-md px-1.5 py-0.5 font-semibold tabular-nums whitespace-nowrap ${r.done >= r.total ? "bg-green-soft text-green" : r.done > 0 ? "bg-amber-soft text-amber" : "bg-danger-soft text-danger"}`}>{r.done}/{r.total}</span>
                  : <span className="text-text-placeholder" title={days[i]! < DUTY_LEDGER_START ? "장부가 쌓이기 전" : "그날 수업 없음"}>{days[i]! < DUTY_LEDGER_START ? "기록 전" : ""}</span>}
              </td>)}
            </tr>)])}
          <tr className="border-line-faint border-t font-semibold">
            <td className="px-2 py-1.5">하루 합계</td>
            {totals.map((t, i) => <td key={i} className="px-1 py-1.5 text-center tabular-nums whitespace-nowrap">{t.total ? `${t.done}/${t.total}` : days[i]! < DUTY_LEDGER_START ? "기록 전" : ""}</td>)}
          </tr>
        </tbody>
      </table>
    </div>
  </div>;
}
