"use client";

import { MATRIX_COLUMNS } from "../../view-admin";
import { inClassOf, judge, kindStatuses, studentLines, sumCells, type Avg, type TreeClass } from "../../view-admin-levels";
import { CountBox } from "./admin-matrix";
import { KindStatusStrip } from "./admin-kind-status";
import { VerdictBadge, VerdictLine } from "./admin-verdict";
import type { StudentsPayload } from "./use-students";

const TH = "text-text-dim px-2 py-1 text-xs font-semibold";

/**
 * 반 단계 — "이 반의 진행 상황"(원장 2026-11-10): 판정 + 근거 · 종류별 상태 · 학생 표(학생 × 종류 · 칸 = 제때/기한 온 것 · 지연 있는 학생 먼저 · 이름을 누르면 그 학생 · **칸을 누르면 그 칸의 업무 목록**).
 * 재료 = 반 집계 GET(부모가 받아 넘긴다). 합과 학생 줄은 같은 반 비교(`inClassOf`)를 쓴다. `kind`가 있으면 그 종류만.
 */
export function ClassLevel({ cls, teacher, avg, payload, failed, kind, onStudent, onCell }: { cls: TreeClass; teacher: string; avg: Avg | null; payload: StudentsPayload | null; failed: boolean; kind: string | null; onStudent: (studentId: string, name: string) => void; /** 칸을 누르면 그 칸의 업무 목록(종류 null = 전체). */ onCell: (studentId: string, name: string, kind: string | null) => void }) {
  const sum = payload ? sumCells(payload.rows, inClassOf(cls.classId)) : null;
  const linesAll = payload ? studentLines(payload.rows, payload.students, cls.classId) : [];
  const lines = kind ? linesAll.filter((l) => l.cells[kind]) : linesAll;
  const cols = MATRIX_COLUMNS.filter((c) => (kind ? c.kind === kind : lines.some((l) => l.cells[c.kind])));
  return <div className="grid gap-4">
    <header className="grid gap-1">
      <h3 className="text-xl font-bold">{cls.name} <span className="text-text-dim text-sm font-medium">{teacher}{lines.length ? ` · ${lines.length}명` : ""}</span></h3>
      <VerdictLine v={judge(cls.cell, avg)} />
    </header>
    {sum ? <KindStatusStrip statuses={kindStatuses(sum.cells)} only={kind} /> : null}
    <section className="border-line-faint rounded-xl border p-3">
      <h4 className="text-sm font-bold">학생</h4>
      {failed ? <p className="text-text-dim mt-2 text-sm">학생 목록 조회 실패</p>
        : !payload ? <p className="text-text-dim mt-2 text-sm">불러오는 중…</p>
        : !lines.length ? <p className="text-text-dim mt-2 text-sm">해당 학생 없음</p>
        : <div className="mt-2 overflow-x-auto">
          <table className="w-full border-separate border-spacing-1 text-center text-sm [&_th:first-child]:text-left">
            <thead><tr><th className={TH}>학생</th><th className={TH}>등급</th>{cols.map((c) => <th key={c.kind} className={TH}>{c.label}</th>)}{kind ? null : <th className={TH}>전체</th>}</tr></thead>
            <tbody>
              {lines.map((l) => <tr key={l.studentId}>
                <td className="px-2 py-0.5 text-left">
                  <button type="button" onClick={() => onStudent(l.studentId, l.name)} className="hover:text-primary text-sm font-bold">{l.name}</button>
                  {l.sub ? <span className="text-text-dim ml-1 text-xs font-medium">{l.sub}</span> : null}
                </td>
                <td className="px-1"><VerdictBadge v={judge(kind ? l.cells[kind] ?? l.all : l.all)} /></td>
                {cols.map((c) => <td key={c.kind} className="p-0"><CountBox cell={l.cells[c.kind] ?? null} frac onClick={l.cells[c.kind] ? () => onCell(l.studentId, l.name, c.kind) : undefined} /></td>)}
                {kind ? null : <td className="p-0"><CountBox cell={l.all} frac onClick={() => onCell(l.studentId, l.name, null)} /></td>}
              </tr>)}
            </tbody>
          </table>
        </div>}
    </section>
  </div>;
}
