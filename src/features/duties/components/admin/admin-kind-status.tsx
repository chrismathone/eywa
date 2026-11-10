"use client";

import { upcomingOf, wellDoneOf } from "../../view-admin";
import type { KindStatus } from "../../view-admin-levels";
import { bandStyle } from "./admin-matrix";

/**
 * 종류별 상태 — 출결 · 보고서 발송 · 학생 상담 · 월말평가 · 신규생 관리 칸(업무가 있는 종류만). 한 칸 = 기한 내 완료율(표의 칸과 같은 숫자 · 같은 색) ·
 * 그 아래 건수(기한 내 완료 n/전체 · 기한 초과 · 기한 후 완료 · 미처리 확정 · 남음). 학생 단계가 쓴다.
 */
export function KindStatusStrip({ statuses, only = null }: { statuses: KindStatus[]; only?: string | null }) {
  const list = only ? statuses.filter((s) => s.kind === only) : statuses;
  if (!list.length) return <p className="text-text-dim text-sm">해당 기간 업무 없음</p>;
  return <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
    {list.map((s) => <div key={s.kind} className="border-line bg-card rounded-xl border px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-bold">{s.label}</span>
        <span className="rounded-md px-1.5 py-0.5 text-sm font-bold tabular-nums" style={bandStyle(s.cell.pct ?? 0)}>{s.cell.pct ?? 0}%</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-2 text-xs font-semibold tabular-nums">
        <span className="text-text-dim">기한 내 완료 {wellDoneOf(s.cell)}/{s.cell.total}</span>
        {s.cell.late ? <span className="text-danger">기한 초과 {s.cell.late}</span> : null}
        {s.cell.lateDone ? <span className="text-amber">기한 후 완료 {s.cell.lateDone}</span> : null}
        {s.cell.expired ? <span className="text-danger">미처리 확정 {s.cell.expired}</span> : null}
        {upcomingOf(s.cell) ? <span className="text-text-dim">남음 {upcomingOf(s.cell)}</span> : null}
      </div>
    </div>)}
  </div>;
}
