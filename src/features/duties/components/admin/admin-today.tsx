"use client";

import { openRows, type TreeOwner } from "../../view-admin-levels";

/**
 * 오늘 미완료(오늘 보기 전용) — 오늘 업무가 덜 끝난 선생님을 남은 것이 많은 순으로: 순위 · 선생님(과목 · 반 · 학생) · 남은 수 · **무엇이 남았는지**(종류별) · 진행 막대.
 * 오늘은 기한이 아직 안 와서 등급·등수가 서지 않는다 — 끝냈나(완료/전체)로만 본다. 줄을 누르면 그 선생님, 종류를 누르면 그 종류로.
 */
export function AdminToday({ owners, onOwner }: { owners: readonly TreeOwner[]; onOwner: (ownerId: string, kind: string | null) => void }) {
  const rows = openRows(owners);
  const open = rows.filter((r) => r.left > 0);
  const done = rows.length - open.length;
  if (!rows.length) return null;
  return <section className="border-line bg-card rounded-xl border p-2">
    <h4 className="px-2 py-1 text-sm font-bold">오늘 미완료 <span className="text-text-dim text-xs font-medium">{open.length}명{done ? ` · 완료 ${done}명` : ""}</span></h4>
    {!open.length ? <p className="text-green px-2 py-3 text-sm font-semibold">오늘 업무 전원 완료</p> : <ol className="grid gap-0.5">
      {open.map((r, i) => <li key={r.ownerId} className="hover:bg-bg-soft flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-2 py-1.5">
        <span className="text-text-dim w-6 shrink-0 text-center text-sm font-bold tabular-nums">{i + 1}</span>
        <button type="button" onClick={() => onOwner(r.ownerId, null)} className="hover:text-primary min-w-0 text-left text-sm font-bold">
          {r.name}{r.meta ? <span className="text-text-dim ml-1.5 text-xs font-medium">{r.meta}</span> : null}
        </button>
        <span className="flex flex-1 flex-wrap items-center gap-1">
          {r.kinds.map((k) => <button key={k.kind} type="button" onClick={() => onOwner(r.ownerId, k.kind)} className="bg-danger-soft text-danger rounded-full px-2 py-0.5 text-xs font-bold whitespace-nowrap hover:brightness-95">{k.label} {k.left}</button>)}
        </span>
        <span className="flex w-44 shrink-0 items-center gap-2">
          <span className="bg-bg-soft h-1.5 flex-1 overflow-hidden rounded-full" aria-hidden><span className="bg-green block h-full" style={{ width: `${Math.round((r.done / r.total) * 100)}%` }} /></span>
          <span className="w-16 text-right text-xs font-semibold tabular-nums">{r.done}/{r.total}</span>
        </span>
      </li>)}
    </ol>}
  </section>;
}
