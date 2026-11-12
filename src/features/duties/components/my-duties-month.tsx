"use client";

import { useState } from "react";
import { ToolbarSegment, ToolbarSegmentItem } from "@/components/toolbar";
import { DUTY_STATE_LABEL, type DutyState } from "../kinds";
import { buildMonthRows, foldRows, groupMonthRows, type MonthRow } from "../view-month";
import type { DutyItemView } from "../kinds";
import { useOpenDutyWork } from "./duty-work-context";

/**
 * '이번 달' 보기 — 탭 둘(원장 2026-11-10 *"월 학부모 상담 / 월말 평가 탭 2개"*): ① 월 학부모 상담(반별 · 아래에 신규생 정착 콜) ② 월말 평가(반별 응시).
 * 숫자는 장부 그대로(상담 의무 = 강사평가·원생상담 통계와 같은 판정 · 월말평가 = 담임 반 명단 응시). 완료된 줄은 누를 수 없다.
 */
type Tab = "counsel" | "exam";
export function MyDutiesMonth({ items, now, month }: { items: DutyItemView[]; now: number; month: string }) {
  const [tab, setTab] = useState<Tab>("counsel");
  const { counsel, exam, newcomer } = buildMonthRows(items, now);
  const mm = Number(month.slice(5));
  return <div className="grid gap-3">
    <ToolbarSegment>
      <ToolbarSegmentItem active={tab === "counsel"} onClick={() => setTab("counsel")}>{mm}월 학생 상담 {foldRows(counsel).done}/{foldRows(counsel).total}</ToolbarSegmentItem>
      <ToolbarSegmentItem active={tab === "exam"} onClick={() => setTab("exam")}>{mm}월 월말평가 {foldRows(exam).done}/{foldRows(exam).total}</ToolbarSegmentItem>
    </ToolbarSegment>
    {tab === "counsel" ? <>
      <Section title="학생 상담" count={foldRows(counsel)} rows={counsel} empty="상담 대상 학생 없음" />
      <Section title="신규생 관리" count={foldRows(newcomer)} rows={newcomer} empty="담당 신규생 없음" hideSingleGroup />
    </> : <Section title="월말평가 응시" count={foldRows(exam)} rows={exam} empty="월말평가 대상 없음" />}
  </div>;
}

const TONE: Record<DutyState, string> = { done: "bg-green-soft text-green", late: "bg-danger-soft text-danger", open: "bg-amber-soft text-amber", void: "bg-bg-soft text-text-placeholder" };
const DOT: Record<DutyState, string> = { done: "bg-green", late: "bg-danger", open: "bg-amber", void: "bg-text-placeholder" };

function Section({ title, count, rows, empty, hideSingleGroup }: { title: string; count: { total: number; done: number; late: number }; rows: MonthRow[]; empty: string; hideSingleGroup?: boolean }) {
  const openWork = useOpenDutyWork();
  const pct = count.total ? Math.round((count.done / count.total) * 100) : 0;
  const groups = groupMonthRows(rows);
  // 내 과목 하나뿐이면 과목 머리줄 자체를 안 그린다 — 머리의 숫자와 겹친다(원장 2026-11-10 *"수학이란 말 없애" · "아래쪽 기한초과 중복이므로 삭제"*).
  const showGroupLine = !(hideSingleGroup && groups.length === 1);
  return <section className="border-line bg-card rounded-xl border">
    <header className="border-line-faint flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
      <div className="flex items-baseline gap-2"><h4 className="text-sm font-bold">{title}</h4><span className="text-text-dim text-xs tabular-nums">{count.done}/{count.total}{count.late ? <span className="text-danger"> · 미처리 {count.late}</span> : null}</span></div>
      <span className="bg-bg-soft h-1.5 w-24 overflow-hidden rounded-full" aria-hidden><span className={`block h-full rounded-full ${pct === 100 ? "bg-green" : "bg-primary"}`} style={{ width: `${pct}%` }} /></span>
    </header>
    {groups.length ? <div className="grid gap-2 p-2">
      {groups.map((g) => <div key={g.name}>
        {showGroupLine ? <div className="flex items-baseline justify-between px-1 py-1"><span className="text-xs font-bold">{g.name}</span>
          <span className="text-xs font-semibold tabular-nums"><span className={g.done === g.total ? "text-green" : "text-foreground"}>{g.done}/{g.total}</span>{g.late ? <span className="text-danger"> · 미처리 {g.late}</span> : null}</span></div> : null}
        <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {g.rows.map((r) => <li key={r.id}>
            {r.state === "done" ? <div className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold ${TONE[r.state]}`} title={DUTY_STATE_LABEL[r.state]}>
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[r.state]}`} aria-hidden />
              <span className="min-w-0 flex-1 truncate"><span className="text-foreground font-bold">{r.title}</span>{r.sub ? <span className="text-text-dim font-medium"> · {r.sub}</span> : null}</span>
              <span className="shrink-0 tabular-nums">{r.dateLabel}</span>
            </div> : <button type="button" onClick={() => openWork({ href: r.href, title: `${r.title} · ${title}` })} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold hover:brightness-95 ${TONE[r.state]}`} title={`${DUTY_STATE_LABEL[r.state]} — 누르면 창 안에서 바로 처리`}>
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[r.state]}`} aria-hidden />
              <span className="min-w-0 flex-1 truncate"><span className="text-foreground font-bold">{r.title}</span>{r.sub ? <span className="text-text-dim font-medium"> · {r.sub}</span> : null}</span>
              <span className="shrink-0 tabular-nums">{r.dateLabel}</span>
            </button>}
          </li>)}
        </ul>
      </div>)}
    </div> : <p className="text-text-dim px-3 pb-3 pt-1 text-sm">{empty}</p>}
  </section>;
}
