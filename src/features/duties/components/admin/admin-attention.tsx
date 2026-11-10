"use client";

import { lateLabel, type AttentionRow } from "../../view-admin";

const pill = (days: number, muted: boolean) => (muted ? "bg-bg-soft text-text-dim" : days >= 7 ? "bg-danger-soft text-danger" : days >= 1 ? "bg-amber-soft text-amber" : "bg-bg-soft text-text-dim");

/**
 * 지연 목록 — 열린 채 기한이 지난 의무 묶음(선생님 · 반 · 학생 단위). 표식 = 가장 오래된 것의 지난 날 수(7일 이상 붉게). 요약 = 종류별 지연 수.
 * 줄을 누르면 부모가 정한다(그 단계로 이동 · 학생 열기 · 제자리에서 펼치기). `expand` = 펼쳐 보일 묶음과 그 안의 줄(트리에 없는 선생님·반일 때).
 * `muted` = 이관된 미확인(평가 시작 전 기한) — 붉게 칠하지 않는다.
 */
export function AdminAttention({ rows, onOpen, expand = null, onOpenChild, muted = false, empty = "기한이 지난 열린 의무가 없습니다." }: {
  rows: AttentionRow[]; onOpen: (row: AttentionRow) => void; expand?: { key: string; rows: AttentionRow[] } | null; onOpenChild?: (row: AttentionRow) => void; muted?: boolean; empty?: string;
}) {
  if (!rows.length) return <p className="text-text-dim px-3 py-6 text-center text-sm">{empty}</p>;
  const line = (r: AttentionRow, open: (row: AttentionRow) => void, child = false) => <button type="button" onClick={() => open(r)} className={`hover:bg-bg-soft grid w-full gap-0.5 rounded-lg px-2.5 py-1.5 text-left ${child ? "pl-6" : ""}`}>
    <span className="flex flex-wrap items-center gap-1.5">
      <span className={`rounded-full px-1.5 py-0.5 text-xs font-bold tabular-nums ${pill(r.days, muted)}`}>{muted ? "이관" : lateLabel(r.days)}</span>
      <span className="text-sm font-bold">{r.title}</span>
      {r.sub ? <span className="text-text-dim text-xs font-medium">{r.sub}</span> : null}
      <span className="text-text-dim ml-auto text-xs font-medium">{[r.teacher, r.className].filter(Boolean).join(" · ")}</span>
    </span>
    <span className={`text-xs font-semibold ${muted ? "text-text-dim" : "text-danger"}`}>{r.summary}</span>
  </button>;
  return <ul className="grid gap-1">
    {rows.map((r) => <li key={r.key}>
      {line(r, onOpen)}
      {expand && expand.key === r.key ? <ul className="grid gap-0.5">{expand.rows.map((c) => <li key={c.key}>{line(c, onOpenChild ?? onOpen, true)}</li>)}</ul> : null}
    </li>)}
  </ul>;
}
