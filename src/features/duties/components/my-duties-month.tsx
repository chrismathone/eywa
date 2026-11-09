"use client";

import { EmbedAnchor } from "@/components/embed-link";
import { DUTY_STATE_LABEL, type DutyState } from "../kinds";
import { buildMonthRows, foldRows, type MonthRow } from "../view-month";
import type { DutyItemView } from "../kinds";

/**
 * '이번 달' 보기 — 월 학부모 상담(학생마다 한 줄 · 누르면 원생상담 작성) · 신규생 정착 콜(학생 × 항목 · 누르면 신규생 관리).
 * 숫자는 장부 그대로(상담 의무 학생 = 강사평가·원생상담 통계와 같은 판정).
 */
export function MyDutiesMonth({ items, now, month }: { items: DutyItemView[]; now: number; month: string }) {
  const { counsel, newcomer } = buildMonthRows(items, now);
  const c = foldRows(counsel), n = foldRows(newcomer);
  if (!counsel.length && !newcomer.length) return <p className="text-text-dim mt-2 text-sm">{month.slice(5)}월 상담 의무 학생과 신규생 정착 콜이 없습니다(담임 반이 없거나 아직 집계 전).</p>;
  return <div className="mt-2 grid gap-3 lg:grid-cols-2">
    <Section title="월 학부모 상담" count={c} hint="의무 학생 = 같은 과목에서 가장 많은 요일을 맡은 담임(영어는 반 담임 전원). 그 달 본인 상담 1건이면 완료 · 기한 말일." rows={counsel} empty="상담 의무 학생이 없습니다." />
    <Section title="신규생 정착 콜" count={n} hint="신규생 관리 체크리스트 항목(사전 콜 · 첫 수업 안내 · OJT · 첫 수업 후 콜 · 1·3개월 콜). 체크하면 완료." rows={newcomer} empty="맡은 신규생 항목이 없습니다." />
  </div>;
}

const TONE: Record<DutyState, string> = { done: "bg-green-soft text-green", late: "bg-danger-soft text-danger", open: "bg-amber-soft text-amber", void: "bg-bg-soft text-text-placeholder" };
const DOT: Record<DutyState, string> = { done: "bg-green", late: "bg-danger", open: "bg-amber", void: "bg-text-placeholder" };

function Section({ title, count, hint, rows, empty }: { title: string; count: { total: number; done: number; late: number }; hint: string; rows: MonthRow[]; empty: string }) {
  const pct = count.total ? Math.round((count.done / count.total) * 100) : 0;
  return <section className="border-line-faint rounded-xl border">
    <header className="border-line-faint flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
      <div className="flex items-baseline gap-2"><h4 className="text-sm font-bold">{title}</h4><span className="text-text-dim text-xs tabular-nums">{count.done}/{count.total}{count.late ? <span className="text-danger"> · 기한 초과 {count.late}</span> : null}</span></div>
      <span className="bg-bg-soft h-1.5 w-24 overflow-hidden rounded-full" aria-hidden><span className={`block h-full rounded-full ${pct === 100 ? "bg-green" : "bg-primary"}`} style={{ width: `${pct}%` }} /></span>
    </header>
    <p className="text-text-dim px-3 pt-2 text-xs">{hint}</p>
    {rows.length ? <ul className="grid gap-1 p-2 sm:grid-cols-2">
      {rows.map((r) => <li key={r.id}>
        <EmbedAnchor href={r.href} className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-semibold hover:brightness-95 ${TONE[r.state]}`} title={`${DUTY_STATE_LABEL[r.state]} — 누르면 기록 화면으로`}>
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[r.state]}`} aria-hidden />
          <span className="min-w-0 flex-1 truncate"><span className="text-foreground font-bold">{r.title}</span>{r.sub ? <span className="text-text-dim font-medium"> · {r.sub}</span> : null}</span>
          <span className="shrink-0 tabular-nums">{r.dateLabel}</span>
        </EmbedAnchor>
      </li>)}
    </ul> : <p className="text-text-dim px-3 pb-3 pt-1 text-sm">{empty}</p>}
  </section>;
}
