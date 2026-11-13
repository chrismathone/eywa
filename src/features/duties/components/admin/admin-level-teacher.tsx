"use client";

import { hasProgressCell, MATRIX_COLUMNS, type AdminPeriod } from "../../view-admin";
import { classLines, judge, NO_CLASS, NO_OWNER, ownerMeta, type Avg, type TreeOwner } from "../../view-admin-levels";
import { CountBox, GridTable, GridWrap, NAME_LONG, NameCell, tableBasis, TD, TH } from "./admin-matrix";
import { MixLegend } from "./admin-mix";
import { VerdictBadge, VerdictLine } from "./admin-verdict";
import { useStudentsPayload } from "./use-students";


/**
 * 선생님 단계 — "이 선생님이 뭘 안 했는지, 뭘 체크해야 하는지"(원장 2026-11-10). 학생 이름을 늘어놓지 않는다(*"쭉 나열하는거 금지"*):
 * ① 판정 + 근거 ② 종류별 상태 ③ **반 × 종류 표**(한 반 한 줄 · 칸 = 기한 준수율 + 지연 수 · 누르면 반 단계에서 학생 표).
 * `kind`가 있으면(매트릭스 칸으로 들어옴) 그 종류만 보인다. '담당 미정'은 담당자 없는 의무만 받는다(`owner=none`).
 */
export function TeacherLevel({ owner, avg, period, subject, tick, kind, aside, onClearKind, onClass }: {
  /** 표 옆(자리가 모자라면 아래)에 세울 것 — 기한 초과. */ aside?: React.ReactNode;
  owner: TreeOwner; avg: Avg | null; period: AdminPeriod; subject: string | null; tick: number; kind: string | null; onClearKind: () => void; onClass: (classId: string) => void;
}) {
  const grade = false; // 반 줄에는 등급이 없다(등급은 선생님 · 과목 줄에만 — 2026-11-11)
  const { data, failed } = useStudentsPayload(period, owner.ownerId === NO_OWNER ? { ownerNone: true, subject } : { owner: owner.ownerId, subject }, tick);
  const linesAll = data ? classLines(data.rows, data.classInfo) : [];
  const lines = kind ? linesAll.filter((l) => l.cells[kind]) : linesAll;
  const cols = MATRIX_COLUMNS.filter((c) => (kind ? c.kind === kind : lines.some((l) => l.cells[c.kind])));
  // 결석으로 빠진 업무 수(반 × 종류) — 그 반의 출결 건수보다 보고서 건수가 적은 까닭을 칸에 적는다.
  const absentOf = (classId: string, k: string) => (data?.absent ?? []).filter((a) => a.kind === k && (a.classId ?? NO_CLASS) === classId).reduce((sum, a) => sum + a.count, 0);
  // 불러오는 동안에도 같은 자리 · 같은 크기 — 열 수는 왼쪽 목록이 이미 아는 이 선생님의 종류로 어림한다.
  const basis = tableBasis(kind ? 1 : MATRIX_COLUMNS.filter((c) => owner.cells[c.kind]?.total).length + 1, grade, NAME_LONG);
  const kindLabel = kind ? MATRIX_COLUMNS.find((c) => c.kind === kind)?.label ?? "" : "";
  return <div className="grid grid-cols-1 gap-4">
    <header className="grid gap-1">
      <h3 className="text-xl font-bold">{owner.name} <span className="text-text-dim text-sm font-medium">{ownerMeta(owner) || `반 ${owner.classes.filter((c) => c.classId !== NO_CLASS).length}`}</span></h3>
      <VerdictLine v={judge(kind ? owner.cells[kind] ?? owner.cell : owner.cell, avg && !kind ? avg : null)} />
      {kind ? <p className="flex items-center gap-2 text-sm font-semibold">
        <span className="bg-primary-soft rounded-full px-2 py-0.5">{kindLabel}만 보는 중</span>
        <button type="button" onClick={onClearKind} className="text-text-dim hover:text-primary text-xs font-semibold underline">전체 항목 보기</button>
      </p> : null}
    </header>
    {/* 표 카드 옆에 '기한 초과'를 세운다(원장 2026-11-11 *"2단으로 해서 공간을 활용"*) — 표가 편하게 서는 폭(`tableBasis`)과 한 줄에 안 들어가면 아래로 내려가고 표가 한 줄을 다 쓴다. */}
    <div className="flex flex-wrap items-stretch gap-4">
    <section className="border-line bg-card min-h-48 max-w-full min-w-[min(100%,640px)] grow rounded-xl border p-3" style={{ flexBasis: basis }}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1"><h4 className="text-sm font-bold">반별</h4><MixLegend className="ml-auto" progress={hasProgressCell(lines.flatMap((l) => cols.map((c) => l.cells[c.kind])))} /></div>
      {failed ? <p className="text-text-dim mt-2 text-sm">반별 집계 조회 실패</p>
        : !data ? <p className="text-text-dim mt-2 text-sm">불러오는 중…</p>
        : !lines.length ? <p className="text-text-dim mt-2 text-sm">해당 기간 업무 없음</p>
        : <GridWrap className="mt-2">
          <GridTable count={cols.length + (kind ? 0 : 1)} grade={grade} name={NAME_LONG}>
            <thead><tr><th className={TH}>반</th>{grade ? <th className={TH}>등급</th> : null}{cols.map((c) => <th key={c.kind} className={TH}>{c.label}</th>)}{kind ? null : <th className={TH}>전체</th>}</tr></thead>
            <tbody>
              {lines.map((l) => <tr key={l.classId}>
                <NameCell name={l.name} meta={`${l.students}명`} onClick={() => onClass(l.classId)}
                  badge={l.cells.newcomer_call ? <span className="bg-primary text-primary-foreground shrink-0 rounded px-1 py-px text-xs leading-tight font-bold" title="신규생 있음">NEW</span> : null} />
                {grade ? <td className="px-1"><VerdictBadge v={judge(kind ? l.cells[kind] ?? l.all : l.all)} /></td> : null}
                {cols.map((c) => <td key={c.kind} className={TD}><CountBox cell={l.cells[c.kind] ?? null} absent={absentOf(l.classId, c.kind)} /></td>)}
                {kind ? null : <td className={TD}><CountBox cell={l.all} /></td>}
              </tr>)}
            </tbody>
          </GridTable>
        </GridWrap>}
    </section>
    {aside ? <div className="grid min-w-[min(100%,400px)] [flex:1000_1_400px] grid-cols-1">{aside}</div> : null}
    </div>
  </div>;
}
