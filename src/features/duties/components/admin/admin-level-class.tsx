"use client";

import { hasProgressCell, MATRIX_COLUMNS } from "../../view-admin";
import { inClassOf, judge, studentLines, sumCells, type TreeClass } from "../../view-admin-levels";
import { CountBox, GridTable, GridWrap, NAME_LONG, NameCell, tableBasis, TD, TH } from "./admin-matrix";
import { MixLegend } from "./admin-mix";
import { VerdictBadge, VerdictLine } from "./admin-verdict";
import type { StudentsPayload } from "./use-students";


/**
 * 반 단계 — "이 반의 진행 상황"(원장 2026-11-10): 판정 + 근거 · 종류별 상태 · 학생 표(학생 × 종류 · 칸 = 제때/기한 온 것 · 지연 있는 학생 먼저 · 이름을 누르면 그 학생 · **칸을 누르면 그 칸의 업무 목록**).
 * 재료 = 반 집계 GET(부모가 받아 넘긴다). 합과 학생 줄은 같은 반 비교(`inClassOf`)를 쓴다. `kind`가 있으면 그 종류만.
 */
export function ClassLevel({ cls, teacher, payload, failed, kind, grade = true, aside, onStudent, onCell }: { cls: TreeClass; /** 표 옆(자리가 모자라면 아래)에 세울 것 — 기한 초과. */ aside?: React.ReactNode; /** 등급 열을 세울지 — 하루 보기에는 없다. */ grade?: boolean; teacher: string; payload: StudentsPayload | null; failed: boolean; kind: string | null; onStudent: (studentId: string, name: string) => void; /** 칸을 누르면 그 칸의 업무 목록(종류 null = 전체). */ onCell: (studentId: string, name: string, kind: string | null) => void }) {
  const sum = payload ? sumCells(payload.rows, inClassOf(cls.classId)) : null;
  const linesAll = payload ? studentLines(payload.rows, payload.students, cls.classId) : [];
  const lines = kind ? linesAll.filter((l) => l.cells[kind]) : linesAll;
  // 결석으로 빠진 업무 — 칸에 '결석 n'이라고 적는다(이 반 것만 · 업무가 그것뿐이면 '결석'만).
  const inThis = inClassOf(cls.classId);
  const absentOf = (studentId: string, k: string) => (payload?.absent ?? []).filter((a) => a.studentId === studentId && a.kind === k && inThis({ classId: a.classId })).reduce((n, a) => n + a.count, 0);
  const cols = MATRIX_COLUMNS.filter((c) => (kind ? c.kind === kind : lines.some((l) => l.cells[c.kind])));
  const basis = tableBasis(Math.max(cols.length, 2) + (kind ? 0 : 1), grade, NAME_LONG);
  return <div className="grid grid-cols-1 gap-4">
    <header className="grid gap-1">
      <h3 className="text-xl font-bold">{cls.name} <span className="text-text-dim text-sm font-medium">{teacher}{lines.length ? ` · ${lines.length}명` : ""}</span></h3>
      <VerdictLine plain v={judge(kind && sum ? sum.cells[kind] ?? cls.cell : cls.cell)} />
    </header>
    {/* 표 카드 옆에 '기한 초과'를 세운다(원장 2026-11-11 *"2단으로 해서 공간을 활용"*) — 표가 편하게 서는 폭(`tableBasis`)과 한 줄에 안 들어가면 아래로 내려가고 표가 한 줄을 다 쓴다. */}
    <div className="flex flex-wrap items-stretch gap-4">
    <section className="border-line bg-card min-h-48 max-w-full min-w-[min(100%,640px)] grow rounded-xl border p-3" style={{ flexBasis: basis }}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1"><h4 className="text-sm font-bold">학생</h4><MixLegend className="ml-auto" progress={hasProgressCell(lines.flatMap((l) => cols.map((c) => l.cells[c.kind])))} /></div>
      {failed ? <p className="text-text-dim mt-2 text-sm">학생 목록 조회 실패</p>
        : !payload ? <p className="text-text-dim mt-2 text-sm">불러오는 중…</p>
        : !lines.length ? <p className="text-text-dim mt-2 text-sm">해당 학생 없음</p>
        : <GridWrap className="mt-2">
          <GridTable count={cols.length + (kind ? 0 : 1)} grade={grade} name={NAME_LONG}>
            <thead><tr><th className={TH}>학생</th>{grade ? <th className={TH}>등급</th> : null}{cols.map((c) => <th key={c.kind} className={TH}>{c.label}</th>)}{kind ? null : <th className={TH}>전체</th>}</tr></thead>
            <tbody>
              {lines.map((l) => <tr key={l.studentId}>
                <NameCell name={l.name} meta={l.sub || null} onClick={() => onStudent(l.studentId, l.name)} />
                {grade ? <td className="px-1"><VerdictBadge v={judge(kind ? l.cells[kind] ?? l.all : l.all)} /></td> : null}
                {cols.map((c) => <td key={c.kind} className={TD}><CountBox cell={l.cells[c.kind] ?? null} absent={absentOf(l.studentId, c.kind)} onClick={l.cells[c.kind] || absentOf(l.studentId, c.kind) ? () => onCell(l.studentId, l.name, c.kind) : undefined} /></td>)}
                {kind ? null : <td className={TD}><CountBox cell={l.all} onClick={() => onCell(l.studentId, l.name, null)} /></td>}
              </tr>)}
            </tbody>
          </GridTable>
        </GridWrap>}
    </section>
    {aside ? <div className="grid min-w-[min(100%,400px)] [flex:1000_1_400px] grid-cols-1">{aside}</div> : null}
    </div>
  </div>;
}
