"use client";

import { DUTY_KIND_KEYS, dutyKindLabel } from "../kinds";
import { CollapseBar, useCollapse } from "./collapse";
import { DUTY_LEDGER_START, buildWeekTable, type DutyWeekCell, type DutyWeekKind } from "../view";

/**
 * '이번 주' 보기 — 반별 표: 줄 = **그 주에 의무가 있던 학생 전원**(오늘 줄만이 아니라 — 원장 2026-11-10 *"월요일것도 전부"*), 칸 = 그날 의무를 **종류별 막대**(출결 · 보고서 · 발송, 색 = 상태)로.
 * 일간을 한 주로 접은 창(주 단위 의무는 없다 — 결정 2026-11-09).
 * 주는 **항상 월요일 시작**(월~금 + 의무 있는 토·일 · 원장 2026-11-10). 오늘 뒤 날은 '예정', 장부 전 날은 '기록 전', 수업 없는 날은 빈 칸.
 * 원장 2026-11-10 *"0/2 라고 적지 말고, 출결/보고서 이렇게 막대그래프"*.
 */
const SHORT: Record<string, string> = { attendance: "출결", report_write: "보고서", report_send: "발송" };
const FILL: Record<DutyWeekKind["state"], string> = { done: "bg-green text-primary-foreground", late: "bg-danger text-primary-foreground", open: "bg-amber-soft text-amber" };

const DOW_KEY = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
export function MyDutiesWeek({ week, days: allDays, today, classDays }: { week: DutyWeekCell[]; days: string[]; today: string; classDays: Record<string, string[]> }) {
  const hasAny = (d: string) => week.some((w) => w.day === d && w.total > 0);
  const days = allDays.filter((d, i) => i < 5 || hasAny(d));
  const groups = buildWeekTable(week);
  const collapse = useCollapse(groups.map((g) => g.classId ?? ""));
  const meets = (classId: string | null, d: string) => !!classId && (classDays[classId] ?? []).includes(DOW_KEY[new Date(Date.parse(`${d}T00:00:00Z`)).getUTCDay()]!);
  const totals = days.map((d) => week.filter((w) => w.day === d).reduce((a, w) => ({ total: a.total + w.total, done: a.done + w.done }), { total: 0, done: 0 }));
  const md = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;
  const DOW = ["일", "월", "화", "수", "목", "금", "토"];
  const dow = (ymd: string) => DOW[new Date(Date.parse(`${ymd}T00:00:00Z`)).getUTCDay()] ?? "";
  // 빈 칸의 글자 — 장부 전 날은 '기록 전', 오늘 뒤 날은 그 반이 **수업하는 요일만** '예정'(원장 2026-11-10), 수업 없는 요일은 빈 칸.
  const empty = (d: string, classId: string | null) => (d < DUTY_LEDGER_START ? "기록 전" : d > today && meets(classId, d) ? "예정" : "");
  const emptyWhy = (d: string, classId: string | null) => (d < DUTY_LEDGER_START ? "장부가 쌓이기 전" : d > today && meets(classId, d) ? "아직 오지 않은 날" : "그날 수업 없음");
  if (!groups.length) return <p className="text-text-dim mt-2 text-sm">이번 주 의무가 아직 없습니다.</p>;
  return <div>
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <p className="text-text-dim text-xs">칸 = 그날 그 학생의 할 일을 종류별 막대로(출결 · 보고서 · 발송). 초록 = 완료 · 주황 = 미완료 · 빨강 = 기한 초과. 빈 칸 = 그날 수업 없음 · 장부는 {md(DUTY_LEDGER_START)}부터.</p>
      <CollapseBar collapse={collapse} />
    </div>
    <div className="overflow-x-auto">
      <table className="w-full table-fixed text-xs">
        <colgroup><col className="w-36" />{days.map((d) => <col key={d} />)}</colgroup>
        <thead>
          <tr className="text-text-dim">
            <th className="px-2 py-1.5 text-left font-semibold">학생</th>
            {days.map((d) => <th key={d} className="px-1 py-1.5 text-center font-semibold whitespace-nowrap"><span className={d === today ? "bg-primary text-primary-foreground inline-block rounded-md px-2 py-0.5" : ""}>{md(d)} <span className="font-medium">{dow(d)}</span></span></th>)}
          </tr>
        </thead>
        <tbody>
          {groups.flatMap((g) => [
            <tr key={`g-${g.classId ?? "none"}`} className="bg-bg-soft cursor-pointer select-none" onClick={() => collapse.toggle(g.classId ?? "")}>
              <td colSpan={days.length + 1} className="px-2 py-1 text-xs font-bold"><span className="text-text-dim mr-1.5 inline-block w-3">{collapse.isOpen(g.classId ?? "") ? "▾" : "▸"}</span>{g.name}<span className="text-text-dim ml-2 font-medium tabular-nums">{g.rows.length}명 · 이번 주 {g.done}/{g.total}{g.late ? <span className="text-danger"> · 기한 초과 {g.late}</span> : g.open ? <span className="text-amber"> · 미완료 {g.open}</span> : null}</span></td>
            </tr>,
            ...(collapse.isOpen(g.classId ?? "") ? g.rows : []).map((c) => <tr key={c.key} className="border-line-faint border-t">
              <td className="overflow-hidden px-2 py-1 pl-4 font-bold whitespace-nowrap">{c.title}</td>
              {days.map((d) => {
                const cell = c.cells.get(d);
                const kinds = (cell?.kinds ?? []).slice().sort((a, b) => DUTY_KIND_KEYS.indexOf(a.kind as never) - DUTY_KIND_KEYS.indexOf(b.kind as never));
                return <td key={d} className="px-1 py-1">
                  {kinds.length ? <div className="flex h-5 w-full overflow-hidden rounded-md" title={kinds.map((k) => `${dutyKindLabel(k.kind)} ${k.state === "done" ? "완료" : k.state === "late" ? "기한 초과" : "미완료"}`).join(" · ")}>
                    {kinds.map((k, i) => <span key={i} className={`flex flex-1 items-center justify-center overflow-hidden text-[length:inherit] font-semibold whitespace-nowrap ${FILL[k.state]} ${i ? "border-l border-white/60" : ""}`}>{SHORT[k.kind] ?? dutyKindLabel(k.kind)}</span>)}
                  </div> : <span className="text-text-placeholder block text-center" title={emptyWhy(d, g.classId)}>{empty(d, g.classId)}</span>}
                </td>;
              })}
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
