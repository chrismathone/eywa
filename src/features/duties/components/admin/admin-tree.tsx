"use client";

import { progressText, type Cell } from "../../view-admin";
import { judge, type TreeSubject } from "../../view-admin-levels";
import { VerdictDot } from "./admin-verdict";

/** 고른 자리 — subject가 undefined면 뿌리(전 과목). owner ""는 '담당 미정'. */
export type Sel = { subject?: string | null; owner: string | null; classId: string | null; studentId: string | null; /** 매트릭스 칸으로 들어왔을 때의 업무 종류(그 종류만 보인다). */ kind?: string | null; /** 빵 부스러기에 적을 이름(고를 때 함께 싣는다). */ studentName?: string };
export const ROOT: Sel = { subject: undefined, owner: null, classId: null, studentId: null };

/** 기한 준수율 — 기한이 온 것이 없으면 진행(완료/전체). */
const pctText = (c: Cell) => (c.pct === null ? progressText(c) : `${c.pct}%`);

/**
 * 왼쪽 트리 — 과목(둘 이상일 때만 머리) → 선생님 → 반(고른 선생님 아래만 편다). 줄마다 판정 점 · 기한 준수율(기한 전이면 완료/전체) · 이 기간 지연 수.
 * 지연만 = 지금 지연이 있는 선생님·반만.
 */
export function AdminTree({ tree, multi, sel, lateOnly, onSelect }: { tree: TreeSubject[]; multi: boolean; sel: Sel; lateOnly: boolean; onSelect: (sel: Sel) => void }) {
  const row = "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-bg-soft";
  const on = "bg-primary-soft";
  return <nav className="grid gap-1" aria-label="과목 · 선생님 · 반">
    {multi ? <button type="button" onClick={() => onSelect(ROOT)} className={`${row} ${sel.subject === undefined ? on : ""}`}>
      <span className="flex-1 text-sm font-bold">전체</span>
    </button> : null}
    {tree.map((s) => {
      const owners = lateOnly ? s.owners.filter((o) => o.cell.late) : s.owners;
      const subjectOn = sel.subject === s.subject;
      return <div key={s.subject ?? ""} className="grid gap-0.5">
        {multi ? <button type="button" onClick={() => onSelect({ subject: s.subject, owner: null, classId: null, studentId: null })} className={`${row} ${subjectOn && sel.owner === null ? on : ""}`}>
          <VerdictDot grade={judge(s.cell).grade} />
          <span className="flex-1 text-sm font-bold">{s.label}</span>
          <span className="text-xs font-semibold tabular-nums">{pctText(s.cell)}{s.cell.late ? <span className="text-danger"> · {s.cell.late}</span> : null}</span>
        </button> : null}
        {owners.map((o) => {
          const ownerOn = subjectOn && sel.owner === o.ownerId;
          const classes = lateOnly ? o.classes.filter((c) => c.cell.late) : o.classes;
          return <div key={o.ownerId} className={multi ? "pl-3" : ""}>
            <button type="button" onClick={() => onSelect({ subject: s.subject, owner: o.ownerId, classId: null, studentId: null })} className={`${row} ${ownerOn && !sel.classId ? on : ""}`}>
              <VerdictDot grade={judge(o.cell).grade} />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{o.name}</span>
              <span className="text-xs font-semibold tabular-nums">{pctText(o.cell)}{o.cell.late ? <span className="text-danger"> · {o.cell.late}</span> : null}</span>
            </button>
            {ownerOn ? <div className="grid gap-0.5 pl-4">
              {classes.map((c) => <button key={c.classId} type="button" onClick={() => onSelect({ subject: s.subject, owner: o.ownerId, classId: c.classId, studentId: null })} className={`${row} ${sel.classId === c.classId ? on : ""}`}>
                <VerdictDot grade={judge(c.cell).grade} />
                <span className="min-w-0 flex-1 truncate text-xs font-semibold">{c.name}</span>
                <span className="text-xs font-medium tabular-nums">{pctText(c.cell)}{c.cell.late ? <span className="text-danger"> · {c.cell.late}</span> : null}</span>
              </button>)}
            </div> : null}
          </div>;
        })}
      </div>;
    })}
  </nav>;
}
