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
      <ToolbarSegmentItem active={tab === "counsel"} onClick={() => setTab("counsel")}>{mm}월 학부모 상담 {foldRows(counsel).done}/{foldRows(counsel).total}</ToolbarSegmentItem>
      <ToolbarSegmentItem active={tab === "exam"} onClick={() => setTab("exam")}>{mm}월 월말평가 {foldRows(exam).done}/{foldRows(exam).total}</ToolbarSegmentItem>
    </ToolbarSegment>
    {tab === "counsel" ? <>
      <Section title="월 학부모 상담" count={foldRows(counsel)} hint="의무 학생 = 같은 과목에서 가장 많은 요일을 맡은 담임(영어는 반 담임 전원). 그 달 본인 상담 1건이면 완료 · 기한 말일." rows={counsel} empty="상담 의무 학생이 없습니다(담임 반이 없거나 아직 집계 전)." />
      <Section title="신규생 정착 콜" count={foldRows(newcomer)} hint="신규생 관리 체크리스트 항목(사전 콜 · 첫 수업 안내 · OJT · 첫 수업 후 콜 · 1·3개월 콜). 체크하면 완료." rows={newcomer} empty="맡은 신규생 항목이 없습니다." />
    </> : <Section title="월말평가 응시" count={foldRows(exam)} hint="담임 반 명단 학생마다 그 달 그 과목 월말평가 기록(성적관리)이 있으면 완료 · 학원이 그 달이나 지난달에 친 과목만 · 기한 말일. 누르면 성적관리로." rows={exam} empty="월말평가를 치는 과목이 없거나 아직 집계 전입니다." />}
  </div>;
}

const TONE: Record<DutyState, string> = { done: "bg-green-soft text-green", late: "bg-danger-soft text-danger", open: "bg-amber-soft text-amber", void: "bg-bg-soft text-text-placeholder" };
const DOT: Record<DutyState, string> = { done: "bg-green", late: "bg-danger", open: "bg-amber", void: "bg-text-placeholder" };

function Section({ title, count, hint, rows, empty }: { title: string; count: { total: number; done: number; late: number }; hint: string; rows: MonthRow[]; empty: string }) {
  const openWork = useOpenDutyWork();
  const pct = count.total ? Math.round((count.done / count.total) * 100) : 0;
  const groups = groupMonthRows(rows);
  return <section className="border-line-faint rounded-xl border">
    <header className="border-line-faint flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
      <div className="flex items-baseline gap-2"><h4 className="text-sm font-bold">{title}</h4><span className="text-text-dim text-xs tabular-nums">{count.done}/{count.total}{count.late ? <span className="text-danger"> · 기한 초과 {count.late}</span> : null}</span></div>
      <span className="bg-bg-soft h-1.5 w-24 overflow-hidden rounded-full" aria-hidden><span className={`block h-full rounded-full ${pct === 100 ? "bg-green" : "bg-primary"}`} style={{ width: `${pct}%` }} /></span>
    </header>
    <p className="text-text-dim px-3 pt-2 text-xs">{hint}</p>
    {groups.length ? <div className="grid gap-2 p-2">
      {groups.map((g) => <div key={g.name}>
        <div className="flex items-baseline justify-between px-1 py-1"><span className="text-xs font-bold">{g.name}</span>
          <span className="text-xs font-semibold tabular-nums"><span className={g.done === g.total ? "text-green" : "text-foreground"}>{g.done}/{g.total}</span>{g.late ? <span className="text-danger"> · 기한 초과 {g.late}</span> : null}</span></div>
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
