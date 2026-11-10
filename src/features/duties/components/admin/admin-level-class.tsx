"use client";

import { MATRIX_COLUMNS } from "../../view-admin";
import { inClassOf, judge, studentLines, sumCells, type Avg, type TreeClass } from "../../view-admin-levels";
import { CountBox, GridCols, gridStyle } from "./admin-matrix";
import { VerdictBadge, VerdictLine } from "./admin-verdict";
import type { StudentsPayload } from "./use-students";

const TH = "text-text-dim px-2 py-1 text-xs font-semibold";

/**
 * 반 단계 — "이 반의 진행 상황"(원장 2026-11-10): 판정 + 근거 · 종류별 상태 · 학생 표(학생 × 종류 · 칸 = 제때/기한 온 것 · 지연 있는 학생 먼저 · 이름을 누르면 그 학생 · **칸을 누르면 그 칸의 업무 목록**).
 * 재료 = 반 집계 GET(부모가 받아 넘긴다). 합과 학생 줄은 같은 반 비교(`inClassOf`)를 쓴다. `kind`가 있으면 그 종류만.
 */
export function ClassLevel({ cls, teacher, avg, payload, failed, kind, grade = true, aside, onStudent, onCell }: { cls: TreeClass; /** 표 옆(자리가 모자라면 아래)에 세울 것 — 기한 초과. */ aside?: React.ReactNode; /** 등급 열을 세울지 — 하루 보기에는 없다. */ grade?: boolean; teacher: string; avg: Avg | null; payload: StudentsPayload | null; failed: boolean; kind: string | null; onStudent: (studentId: string, name: string) => void; /** 칸을 누르면 그 칸의 업무 목록(종류 null = 전체). */ onCell: (studentId: string, name: string, kind: string | null) => void }) {
  const sum = payload ? sumCells(payload.rows, inClassOf(cls.classId)) : null;
  const linesAll = payload ? studentLines(payload.rows, payload.students, cls.classId) : [];
  const lines = kind ? linesAll.filter((l) => l.cells[kind]) : linesAll;
  // 결석으로 빠진 의무 — 칸이 비었을 때 '결석'이라고 적는다(이 반 것만).
  const inThis = inClassOf(cls.classId);
  const absentOf = (studentId: string, k: string) => (payload?.absent ?? []).filter((a) => a.studentId === studentId && a.kind === k && inThis({ classId: a.classId })).reduce((n, a) => n + a.count, 0);
  const cols = MATRIX_COLUMNS.filter((c) => (kind ? c.kind === kind : lines.some((l) => l.cells[c.kind])));
  return <div className="grid gap-4">
    <header className="grid gap-1">
      <h3 className="text-xl font-bold">{cls.name} <span className="text-text-dim text-sm font-medium">{teacher}{lines.length ? ` · ${lines.length}명` : ""}</span></h3>
      <VerdictLine v={judge(kind && sum ? sum.cells[kind] ?? cls.cell : cls.cell, kind ? null : avg)} />
    </header>
    {/* 표(칸 수만큼만 넓다) 옆의 빈 자리에 '기한 초과'을 세운다 — 자리가 모자라면 아래로 내려간다(원장 2026-11-11 *"2단으로 해서 공간을 활용"*). */}
    <div className="flex flex-wrap items-stretch gap-4">
    <section className="border-line bg-card min-h-48 max-w-full min-w-[min(100%,640px)] flex-none rounded-xl border p-3">
      <h4 className="text-sm font-bold">학생</h4>
      {failed ? <p className="text-text-dim mt-2 text-sm">학생 목록 조회 실패</p>
        : !payload ? <p className="text-text-dim mt-2 text-sm">불러오는 중…</p>
        : !lines.length ? <p className="text-text-dim mt-2 text-sm">해당 학생 없음</p>
        : <div className="mt-2 overflow-x-auto">
          <table className="table-fixed border-separate border-spacing-1 text-center text-sm [&_th:first-child]:text-left" style={gridStyle(cols.length + (kind ? 0 : 1), grade)}>
            <GridCols count={cols.length + (kind ? 0 : 1)} grade={grade} />
            <thead><tr><th className={TH}>학생</th>{grade ? <th className={TH}>등급</th> : null}{cols.map((c) => <th key={c.kind} className={TH}>{c.label}</th>)}{kind ? null : <th className={TH}>전체</th>}</tr></thead>
            <tbody>
              {lines.map((l) => <tr key={l.studentId}>
                <td className="px-2 py-0.5 text-left">
                  <button type="button" onClick={() => onStudent(l.studentId, l.name)} className="hover:text-primary text-sm font-bold">{l.name}</button>
                  {l.sub ? <span className="text-text-dim ml-1 text-xs font-medium">{l.sub}</span> : null}
                </td>
                {grade ? <td className="px-1"><VerdictBadge v={judge(kind ? l.cells[kind] ?? l.all : l.all)} /></td> : null}
                {cols.map((c) => <td key={c.kind} className="p-0">{!l.cells[c.kind] && absentOf(l.studentId, c.kind)
                  ? <span className="bg-bg-soft text-text-dim block rounded-lg px-1 py-1.5 text-sm font-semibold" title="결석 · 업무 없음">결석{absentOf(l.studentId, c.kind) > 1 ? ` ${absentOf(l.studentId, c.kind)}` : ""}</span>
                  : <CountBox cell={l.cells[c.kind] ?? null} frac onClick={l.cells[c.kind] ? () => onCell(l.studentId, l.name, c.kind) : undefined} />}</td>)}
                {kind ? null : <td className="p-0"><CountBox cell={l.all} overall onClick={() => onCell(l.studentId, l.name, null)} /></td>}
              </tr>)}
            </tbody>
          </table>
        </div>}
    </section>
    {aside ? <div className="grid min-w-[min(100%,400px)] flex-1">{aside}</div> : null}
    </div>
  </div>;
}
