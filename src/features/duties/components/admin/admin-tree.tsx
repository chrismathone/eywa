"use client";

import { shownOf, type Cell } from "../../view-admin";
import { judge, ownerMeta, type TreeSubject } from "../../view-admin-levels";
import { TierStars } from "@/features/student-contribution/components/relative-score";
import { VerdictDot } from "./admin-verdict";

/** 고른 자리 — subject가 undefined면 뿌리(전 과목). owner ""는 '담당 미정'. */
export type Sel = { subject?: string | null; owner: string | null; classId: string | null; studentId: string | null; /** 매트릭스 칸으로 들어왔을 때의 업무 종류(그 종류만 보인다). */ kind?: string | null; /** 빵 부스러기에 적을 이름(고를 때 함께 싣는다). */ studentName?: string };
export const ROOT: Sel = { subject: undefined, owner: null, classId: null, studentId: null };

/**
 * 줄 오른쪽 표시 — **별**(로열티와 같은 9등급 · 원장 2026-11-10 *"% 말고 이 선생님이 잘하고 있다는걸 확인해야하니까 왼쪽 리스트도 별로"*) + 붉은 지연 수.
 * 등급이 없으면(때가 된 업무 3건 미만) 표의 칸과 같은 분자/분모만. 정확한 %는 마우스 오버에.
 */
function Mark({ cell }: { cell: Cell }) {
  const v = judge(cell);
  return <span className="flex shrink-0 items-center gap-1 text-xs font-semibold tabular-nums" title={v.tier && cell.pct !== null ? `${v.label} · 기한 내 완료율 ${cell.pct}%` : undefined}>
    {v.tier ? <TierStars tier={`${v.tier}등급`} /> : <span className="text-text-dim font-medium">{shownOf(cell)?.num ?? 0}/{shownOf(cell)?.den ?? 0}</span>}
    {cell.late ? <span className="text-danger">{cell.late}</span> : null}
  </span>;
}

/**
 * 왼쪽 트리 — 과목(둘 이상일 때만 머리) → 선생님 → 반(고른 선생님 아래만 편다). 줄마다 등급 점 · 별(등급 전이면 완료/전체) · 이 기간 지연 수.
 * 지연만 = 지금 지연이 있는 선생님·반만.
 */
export function AdminTree({ tree, multi, sel, lateOnly, onSelect }: { tree: TreeSubject[]; multi: boolean; sel: Sel; lateOnly: boolean; onSelect: (sel: Sel) => void }) {
  // 줄은 낮게 한 줄로(원장 2026-11-11 *"왼쪽 리스트 탭 행높이를 줄이고"*) — 이름 옆에 과목 · 반 · 학생 수를 이어 적고, 자리가 모자라면 그 뒤를 줄인다.
  const row = "flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left hover:bg-bg-soft";
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
          <Mark cell={s.cell} />
        </button> : null}
        {owners.map((o) => {
          const ownerOn = subjectOn && sel.owner === o.ownerId;
          const classes = lateOnly ? o.classes.filter((c) => c.cell.late) : o.classes;
          return <div key={o.ownerId} className={multi ? "pl-3" : ""}>
            <button type="button" onClick={() => onSelect({ subject: s.subject, owner: o.ownerId, classId: null, studentId: null })} className={`${row} ${ownerOn && !sel.classId ? on : ""}`}>
              <VerdictDot grade={judge(o.cell).grade} />
              <span className="min-w-0 flex-1 overflow-hidden text-sm font-semibold text-ellipsis whitespace-nowrap" title={ownerMeta(o) ? `${o.name} · ${ownerMeta(o)}` : undefined}>{o.name}{ownerMeta(o) ? <span className="text-text-dim ml-1.5 text-xs font-medium">{ownerMeta(o)}</span> : null}</span>
              <Mark cell={o.cell} />
            </button>
            {ownerOn ? <div className="grid gap-0.5 pl-4">
              {classes.map((c) => <button key={c.classId} type="button" onClick={() => onSelect({ subject: s.subject, owner: o.ownerId, classId: c.classId, studentId: null })} className={`${row} ${sel.classId === c.classId ? on : ""}`}>
                <span className="min-w-0 flex-1 truncate text-xs font-semibold">{c.name}</span>
                <span className="flex shrink-0 items-center gap-1 text-xs font-semibold tabular-nums"><span>{shownOf(c.cell)?.judged ? `${shownOf(c.cell)!.pct}%` : `${shownOf(c.cell)?.num ?? 0}/${shownOf(c.cell)?.den ?? 0}`}</span>{c.cell.late ? <span className="text-danger">{c.cell.late}</span> : null}</span>
              </button>)}
            </div> : null}
          </div>;
        })}
      </div>;
    })}
  </nav>;
}
