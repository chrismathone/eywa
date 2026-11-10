"use client";

import { MATRIX_COLUMNS } from "../../view-admin";
import { openRows, type TreeOwner } from "../../view-admin-levels";

/**
 * 미완료(하루 보기 전용) — 그날 업무가 덜 끝난 선생님을 남은 것이 많은 순으로: 순위 · 선생님(과목 · 반 · 학생) · **무엇이 남았는지**(종류별) · 진행 막대 · 완료/전체.
 * 하루치는 기한이 아직 안 왔을 수 있어 등급·등수가 서지 않는다 — 끝냈나(완료/전체)로만 본다. 이름을 누르면 그 선생님, 종류를 누르면 그 종류로.
 * 열은 줄마다 같은 자리다(원장 2026-11-11 *"열 너비 정리해서 라벨 위치 동일하게"*) — 종류마다 칸 하나씩이라 '출결'은 늘 같은 세로줄에 선다(남은 것이 없으면 그 칸은 빈다).
 */
export function AdminToday({ owners, onOwner }: { owners: readonly TreeOwner[]; onOwner: (ownerId: string, kind: string | null) => void }) {
  const rows = openRows(owners);
  const open = rows.filter((r) => r.left > 0);
  const done = rows.length - open.length;
  if (!rows.length) return null;
  // 이 목록에 실제로 남아 있는 종류만 열로(표와 같은 순서).
  const kinds = MATRIX_COLUMNS.filter((c) => open.some((r) => r.kinds.some((k) => k.kind === c.kind)));
  const columns = `28px minmax(0, 300px) repeat(${kinds.length}, 124px) minmax(16px, 1fr) 120px 64px`;
  return <section className="border-line bg-card rounded-xl border p-2">
    <h4 className="px-2 py-1 text-sm font-bold">미완료 <span className="text-text-dim text-xs font-medium">{open.length}명{done ? ` · 완료 ${done}명` : ""}</span></h4>
    {!open.length ? <p className="text-green px-2 py-3 text-sm font-semibold">전원 완료</p> : <div className="overflow-x-auto"><ol className="grid min-w-max gap-0.5">
      {open.map((r, i) => <li key={r.ownerId} className="hover:bg-bg-soft grid items-center gap-x-2 rounded-lg px-2 py-1.5" style={{ gridTemplateColumns: columns }}>
        <span className="text-text-dim text-center text-sm font-bold tabular-nums">{i + 1}</span>
        <button type="button" onClick={() => onOwner(r.ownerId, null)} className="hover:text-primary min-w-0 overflow-hidden text-left text-sm font-bold text-ellipsis whitespace-nowrap">
          {r.name}{r.meta ? <span className="text-text-dim ml-1.5 text-xs font-medium">{r.meta}</span> : null}
        </button>
        {kinds.map((c) => { const k = r.kinds.find((x) => x.kind === c.kind); return <span key={c.kind}>
          {k ? <button type="button" onClick={() => onOwner(r.ownerId, k.kind)} className="bg-danger-soft text-danger rounded-full px-2 py-0.5 text-xs font-bold whitespace-nowrap hover:brightness-95">{k.label} {k.left}</button> : null}
        </span>; })}
        <span aria-hidden />
        <span className="bg-bg-soft h-1.5 overflow-hidden rounded-full" aria-hidden><span className="bg-green block h-full" style={{ width: `${Math.round((r.done / r.total) * 100)}%` }} /></span>
        <span className="text-right text-xs font-semibold tabular-nums">{r.done}/{r.total}</span>
      </li>)}
    </ol></div>}
  </section>;
}
