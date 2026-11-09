"use client";

import type { DutyItemView } from "../kinds";
import { buildDutyCards, groupCardsByClass, type DutyWeekCell } from "../view";

/**
 * '이번 주' 보기 — 학생 × 최근 7일 표. 칸 = 그날 그 학생 의무 완료 비율(의무 없는 날은 빈 칸). 오늘 의무가 있는 학생이 줄로 선다.
 * 일간을 7일로 접은 창이다(주 단위 의무는 없다 — 결정 2026-11-09).
 */
export function MyDutiesWeek({ items, week, days, now }: { items: DutyItemView[]; week: DutyWeekCell[]; days: string[]; now: number }) {
  const groups = groupCardsByClass(buildDutyCards(items, week, days, now), now);
  const cards = groups.flatMap((g) => g.cards);
  const totals = days.map((d) => week.filter((w) => w.day === d).reduce((a, w) => ({ total: a.total + w.total, done: a.done + w.done }), { total: 0, done: 0 }));
  const md = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;
  const DOW = ["일", "월", "화", "수", "목", "금", "토"];
  // 날짜 글자를 UTC 자정으로 읽으면 getUTCDay가 그 달력일의 요일이다(시간대 보정 불필요).
  const dow = (ymd: string) => DOW[new Date(Date.parse(`${ymd}T00:00:00Z`)).getUTCDay()] ?? "";
  if (!cards.length) return <p className="text-text-dim mt-2 text-sm">오늘 의무가 있는 학생이 없어 주간 표를 그릴 수 없습니다.</p>;
  return <div className="mt-2 overflow-x-auto">
    <table className="w-full min-w-[520px] text-xs">
      <thead>
        <tr className="text-text-dim">
          <th className="px-2 py-1.5 text-left font-semibold">학생</th>
          {days.map((d, i) => <th key={d} className={`px-1 py-1.5 text-center font-semibold ${i === days.length - 1 ? "text-foreground" : ""}`}>{md(d)}<span className="block text-xs font-medium">{dow(d)}</span></th>)}
        </tr>
      </thead>
      <tbody>
        {groups.flatMap((g) => [
          <tr key={`g-${g.classId ?? "none"}`} className="bg-bg-soft">
            <td colSpan={days.length + 1} className="px-2 py-1 text-xs font-bold">{g.name}<span className="text-text-dim ml-2 font-medium tabular-nums">오늘 {g.done}/{g.total}{g.late ? <span className="text-danger"> · 기한 초과 {g.late}</span> : null}</span></td>
          </tr>,
          ...g.cards.map((c) => <tr key={c.key} className="border-line-faint border-t">
          <td className="px-2 py-1 pl-4 font-bold">{c.title}</td>
          {c.week.map((r, i) => <td key={i} className="px-1 py-1 text-center">
            <span className={`inline-block h-5 w-9 rounded-md text-xs font-semibold leading-5 tabular-nums ${r == null ? "bg-bg-soft text-text-placeholder" : r >= 1 ? "bg-green-soft text-green" : r > 0 ? "bg-amber-soft text-amber" : "bg-danger-soft text-danger"}`}>
              {r == null ? "—" : `${Math.round(r * 100)}%`}
            </span>
          </td>)}
        </tr>)])}
        <tr className="border-line-faint border-t font-semibold">
          <td className="px-2 py-1.5">하루 합계</td>
          {totals.map((t, i) => <td key={i} className="px-1 py-1.5 text-center tabular-nums">{t.total ? `${t.done}/${t.total}` : "—"}</td>)}
        </tr>
      </tbody>
    </table>
  </div>;
}
