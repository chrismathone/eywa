"use client";

import { DUTY_KIND_KEYS, dutyKindLabel } from "../kinds";
import { useCollapse } from "./collapse";
import { DUTY_LEDGER_START, buildWeekTable, type DutyWeekCell, type DutyWeekKind } from "../view";

/**
 * '이번 주' 보기 — 반별 표: 줄 = **그 주에 의무가 있던 학생 전원**(오늘 줄만이 아니라 — 원장 2026-11-10 *"월요일것도 전부"*), 칸 = 그날 의무를 **종류별 막대**(출결 · 보고서 · 발송, 색 = 상태)로.
 * 일간을 한 주로 접은 창(주 단위 의무는 없다 — 결정 2026-11-09).
 * 주는 **항상 월요일 시작**(월~금 + 의무 있는 토·일 · 원장 2026-11-10). 오늘 뒤 날은 '예정', 장부 전 날은 '기록 전', 수업 없는 날은 빈 칸.
 * 원장 2026-11-10 *"0/2 라고 적지 말고, 출결/보고서 이렇게 막대그래프"*.
 */
const SHORT: Record<string, string> = { attendance: "출결", report_write: "보고서", report_send: "보고서 발송" };
const FILL: Record<DutyWeekKind["state"], string> = { done: "bg-green text-primary-foreground", late: "bg-danger text-primary-foreground", open: "bg-surface-hi text-green", absent: "bg-bg-soft text-text-dim" };
const STATE_LABEL: Record<DutyWeekKind["state"], string> = { done: "완료", late: "미처리", open: "남음", absent: "결석(업무 없음)" };

const DOW_KEY = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DOW_KO: Record<string, string> = { mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일" };
const DOW_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
export function MyDutiesWeek({ week, days: allDays, today, classDays, studentDays = {}, defaultClosed = false }: { week: DutyWeekCell[]; days: string[]; today: string; classDays: Record<string, string[]>; studentDays?: Record<string, string[]>; defaultClosed?: boolean }) {
  // 결석만 있는 날(업무 0건)도 열을 세운다 — '결석' 조각이 주말이라고 사라지지 않게.
  const hasAny = (d: string) => week.some((w) => w.day === d && (w.total > 0 || (w.kinds?.length ?? 0) > 0));
  const days = allDays.filter((d, i) => i < 5 || hasAny(d));
  const groups = buildWeekTable(week);
  const collapse = useCollapse(groups.map((g) => g.classId ?? ""), defaultClosed);
  // 등원 요일 열(원장 2026-11-10) — 반 수업 요일 ∩ 분리등원 요일.
  const dowOf = (studentKey: string, classId: string | null) => (classId ? (studentDays[`${studentKey}|${classId}`] ?? classDays[classId] ?? []) : [])
    .slice().sort((a, b) => DOW_ORDER.indexOf(a) - DOW_ORDER.indexOf(b)).map((d) => DOW_KO[d] ?? d).join("·");
  const meets = (classId: string | null, d: string) => !!classId && (classDays[classId] ?? []).includes(DOW_KEY[new Date(Date.parse(`${d}T00:00:00Z`)).getUTCDay()]!);
  const totals = days.map((d) => week.filter((w) => w.day === d).reduce((a, w) => ({ total: a.total + w.total, done: a.done + w.done }), { total: 0, done: 0 }));
  const md = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;
  const DOW = ["일", "월", "화", "수", "목", "금", "토"];
  const dow = (ymd: string) => DOW[new Date(Date.parse(`${ymd}T00:00:00Z`)).getUTCDay()] ?? "";
  // 빈 칸의 글자 — 장부 전 날은 '기록 전', 오늘 뒤 날은 그 반이 **수업하는 요일만** '예정'(원장 2026-11-10), 수업 없는 요일은 빈 칸.
  const empty = (d: string, classId: string | null) => (d < DUTY_LEDGER_START ? "기록 전" : d > today && meets(classId, d) ? "예정" : "");
  const emptyWhy = (d: string, classId: string | null) => (d < DUTY_LEDGER_START ? "기록 시작 전" : d > today && meets(classId, d) ? "아직 오지 않은 날" : "그날 수업 없음");
  if (!groups.length) return <p className="text-text-dim mt-2 text-sm">이번 주 업무 없음</p>;
  return <div>
    <div className="overflow-x-auto">
      <table className="w-full table-fixed text-xs">
        <colgroup><col className="w-32" /><col className="w-24" />{days.map((d) => <col key={d} />)}</colgroup>
        <thead>
          <tr className="text-text-dim">
            <th className="px-2 py-1.5 text-left font-semibold">학생</th>
            <th className="px-1 py-1.5 text-center font-semibold">등원 요일</th>
            {days.map((d) => <th key={d} className="px-1 py-1.5 text-center font-semibold whitespace-nowrap"><span className={d === today ? "bg-primary text-primary-foreground inline-block rounded-md px-2 py-0.5" : ""}>{md(d)} <span className="font-medium">{dow(d)}</span></span></th>)}
          </tr>
        </thead>
        <tbody>
          {groups.flatMap((g) => [
            <tr key={`g-${g.classId ?? "none"}`} className="bg-bg-soft cursor-pointer select-none" onClick={() => collapse.toggle(g.classId ?? "")}>
              <td colSpan={days.length + 2} className="px-2 py-1 text-xs font-bold"><span className="text-text-dim mr-1.5 inline-block w-3">{collapse.isOpen(g.classId ?? "") ? "▾" : "▸"}</span>{g.name}<span className="text-text-dim ml-2 font-medium tabular-nums">{g.rows.length}명 · 이번 주 {g.done}/{g.total}{g.late ? <span className="text-danger"> · 미처리 {g.late}</span> : g.open ? <span className="text-amber"> · 남음 {g.open}</span> : null}</span></td>
            </tr>,
            ...(collapse.isOpen(g.classId ?? "") ? g.rows : []).map((c) => <tr key={c.key} className="border-line-faint border-t">
              <td className="overflow-hidden px-2 py-1 pl-4 font-bold whitespace-nowrap">{c.title}</td>
              <td className="text-text-dim px-1 py-1 text-center whitespace-nowrap">{dowOf(c.key, g.classId)}</td>
              {days.map((d) => {
                const cell = c.cells.get(d);
                const sorted = (cell?.kinds ?? []).slice().sort((a, b) => DUTY_KIND_KEYS.indexOf(a.kind as never) - DUTY_KIND_KEYS.indexOf(b.kind as never));
                // 결석으로 빠진 보고서 업무는 종류가 둘(작성 · 발송)이어도 '결석' 조각 하나로 적는다.
                const kinds = sorted.filter((k, i) => k.state !== "absent" || sorted.findIndex((x) => x.state === "absent") === i);
                return <td key={d} className="px-1 py-1">
                  {kinds.length ? <div className="border-green flex h-5 w-full overflow-hidden rounded-md border" title={sorted.map((k) => `${dutyKindLabel(k.kind)} ${STATE_LABEL[k.state]}`).join(" · ")}>
                    {kinds.map((k, i) => <span key={i} className={`flex flex-1 items-center justify-center overflow-hidden text-[length:inherit] font-semibold whitespace-nowrap ${FILL[k.state]} ${i ? "border-green border-l" : ""}`}>{k.state === "absent" ? "결석" : SHORT[k.kind] ?? dutyKindLabel(k.kind)}</span>)}
                  </div> : <span className="text-text-placeholder block text-center" title={emptyWhy(d, g.classId)}>{empty(d, g.classId)}</span>}
                </td>;
              })}
            </tr>)])}
          <tr className="border-line-faint border-t font-semibold">
            <td className="px-2 py-1.5" colSpan={2}>하루 합계</td>
            {totals.map((t, i) => <td key={i} className="px-1 py-1.5 text-center tabular-nums whitespace-nowrap">{t.total ? `${t.done}/${t.total}` : days[i]! < DUTY_LEDGER_START ? "기록 전" : ""}</td>)}
          </tr>
        </tbody>
      </table>
    </div>
  </div>;
}
