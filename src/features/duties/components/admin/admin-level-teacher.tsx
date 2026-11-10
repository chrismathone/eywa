"use client";

import { MATRIX_COLUMNS, type AdminPeriod } from "../../view-admin";
import { classLines, judge, kindStatuses, NO_CLASS, NO_OWNER, ownerMeta, type Avg, type TreeOwner } from "../../view-admin-levels";
import { CountBox, GridCols, gridStyle } from "./admin-matrix";
import { KindStatusStrip } from "./admin-kind-status";
import { VerdictBadge, VerdictLine } from "./admin-verdict";
import { useStudentsPayload } from "./use-students";

const TH = "text-text-dim px-2 py-1 text-xs font-semibold";

/**
 * 선생님 단계 — "이 선생님이 뭘 안 했는지, 뭘 체크해야 하는지"(원장 2026-11-10). 학생 이름을 늘어놓지 않는다(*"쭉 나열하는거 금지"*):
 * ① 판정 + 근거 ② 종류별 상태 ③ **반 × 종류 표**(한 반 한 줄 · 칸 = 기한 준수율 + 지연 수 · 누르면 반 단계에서 학생 표).
 * `kind`가 있으면(매트릭스 칸으로 들어옴) 그 종류만 보인다. '담당 미정'은 담당자 없는 의무만 받는다(`owner=none`).
 */
export function TeacherLevel({ owner, avg, period, subject, tick, kind, onClearKind, onClass }: {
  owner: TreeOwner; avg: Avg | null; period: AdminPeriod; subject: string | null; tick: number; kind: string | null; onClearKind: () => void; onClass: (classId: string) => void;
}) {
  const { data, failed } = useStudentsPayload(period, owner.ownerId === NO_OWNER ? { ownerNone: true, subject } : { owner: owner.ownerId, subject }, tick);
  const linesAll = data ? classLines(data.rows, data.classInfo) : [];
  const lines = kind ? linesAll.filter((l) => l.cells[kind]) : linesAll;
  const cols = MATRIX_COLUMNS.filter((c) => (kind ? c.kind === kind : lines.some((l) => l.cells[c.kind])));
  const kindLabel = kind ? MATRIX_COLUMNS.find((c) => c.kind === kind)?.label ?? "" : "";
  return <div className="grid gap-4">
    <header className="grid gap-1">
      <h3 className="text-xl font-bold">{owner.name} <span className="text-text-dim text-sm font-medium">{ownerMeta(owner) || `반 ${owner.classes.filter((c) => c.classId !== NO_CLASS).length}`}</span></h3>
      <VerdictLine v={judge(kind ? owner.cells[kind] ?? owner.cell : owner.cell, avg && !kind ? avg : null)} />
      {kind ? <p className="flex items-center gap-2 text-sm font-semibold">
        <span className="bg-primary-soft rounded-full px-2 py-0.5">{kindLabel}만 보는 중</span>
        <button type="button" onClick={onClearKind} className="text-text-dim hover:text-primary text-xs font-semibold underline">전체 종류 보기</button>
      </p> : null}
    </header>
    <KindStatusStrip statuses={kindStatuses(owner.cells)} only={kind} />
    <section className="border-line bg-card rounded-xl border p-3">
      <h4 className="text-sm font-bold">반별</h4>
      {failed ? <p className="text-text-dim mt-2 text-sm">반별 집계 조회 실패</p>
        : !data ? <p className="text-text-dim mt-2 text-sm">불러오는 중…</p>
        : !lines.length ? <p className="text-text-dim mt-2 text-sm">해당 기간 업무 없음</p>
        : <div className="mt-2 overflow-x-auto">
          <table className="table-fixed border-separate border-spacing-1 text-center text-sm [&_th:first-child]:text-left" style={gridStyle(cols.length + (kind ? 0 : 1))}>
            <GridCols count={cols.length + (kind ? 0 : 1)} />
            <thead><tr><th className={TH}>반</th><th className={TH}>등급</th>{cols.map((c) => <th key={c.kind} className={TH}>{c.label}</th>)}{kind ? null : <th className={TH}>전체</th>}</tr></thead>
            <tbody>
              {lines.map((l) => <tr key={l.classId}>
                <td className="px-2 py-0.5 text-left">
                  <button type="button" onClick={() => onClass(l.classId)} className="hover:text-primary text-sm font-bold">{l.name}</button>
                  <span className="text-text-dim ml-1 text-xs font-medium">{l.students}명</span>
                </td>
                <td className="px-1"><VerdictBadge v={judge(kind ? l.cells[kind] ?? l.all : l.all)} /></td>
                {cols.map((c) => <td key={c.kind} className="p-0"><CountBox cell={l.cells[c.kind] ?? null} /></td>)}
                {kind ? null : <td className="p-0"><CountBox cell={l.all} /></td>}
              </tr>)}
            </tbody>
          </table>
        </div>}
    </section>
  </div>;
}
