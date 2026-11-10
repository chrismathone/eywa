"use client";

import { cellTone, earlyDoneOf, progressText } from "../../view-admin";
import type { KindStatus } from "../../view-admin-levels";
import { TONE } from "./admin-matrix";

/**
 * 종류별 상태 — 출결 · 보고서 · 발송 · 월 상담 · 월말평가 · 신규생 정착 칸(의무가 있는 종류만). 한 칸 = 기한 준수율(없으면 '예정') ·
 * 제때 o/기한 온 것 · 지금 지연 · 늦게 끝냄 · 미이행 확정 · 기한 전. 기한 전은 중립색 — 아직 잘못이 아니다. 선생님·반·학생 단계가 같은 부품을 쓴다.
 */
export function KindStatusStrip({ statuses, only = null }: { statuses: KindStatus[]; only?: string | null }) {
  const list = only ? statuses.filter((s) => s.kind === only) : statuses;
  if (!list.length) return <p className="text-text-dim text-sm">이 기간의 의무가 없습니다.</p>;
  return <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
    {list.map((s) => <div key={s.kind} className="border-line-faint rounded-xl border px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-bold">{s.label}</span>
        <span className={`rounded-md px-1.5 py-0.5 text-sm font-bold tabular-nums ${TONE[cellTone(s.cell)]}`}>{s.cell.pct === null ? progressText(s.cell) : `${s.cell.pct}%`}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-2 text-xs font-semibold tabular-nums">
        {s.cell.due ? <span className="text-text-dim">제때 {s.cell.ontime}/{s.cell.due}</span> : null}
        {s.cell.late ? <span className="text-danger">지연 {s.cell.late}</span> : null}
        {s.cell.lateDone ? <span className="text-amber">늦게 끝냄 {s.cell.lateDone}</span> : null}
        {s.cell.expired ? <span className="text-danger">미이행 확정 {s.cell.expired}</span> : null}
        {s.upcoming ? <span className="text-text-dim">기한 전 {s.upcoming}</span> : null}
        {earlyDoneOf(s.cell) ? <span className="text-text-dim">미리 끝냄 {earlyDoneOf(s.cell)}</span> : null}
      </div>
    </div>)}
  </div>;
}
