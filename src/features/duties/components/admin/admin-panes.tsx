"use client";

import { useState } from "react";
import { foldMatrixRows, MATRIX_COLUMNS, type AdminPeriod, type LateItem, type MatrixRow } from "../../view-admin";
import { CellItemsDialog, type CellPick } from "./admin-cell-items";
import { judge, NO_CLASS, NO_OWNER, ownerMeta, type TreeSubject } from "../../view-admin-levels";
import type { DutyWork } from "../duty-work-context";
import { AdminKpiRow } from "./admin-subject";
import { AdminMatrix } from "./admin-matrix";
import { VerdictLine } from "./admin-verdict";
import { ClassLevel } from "./admin-level-class";
import { StudentLevel } from "./admin-level-student";
import { useStudentsPayload } from "./use-students";

/** 과목(또는 전체) 단계 — 요약 칸 넷 · 판정 · (전체 단계 · 학원 전체를 보는 사람) 과목 관리자별 현황 · 지금 지연(먼저 손댈 것) · 선생님 × 종류 매트릭스(이름 = 그 선생님 · 칸 = 그 선생님의 그 종류). */
export function SubjectLevel({ node, lateOnly, avgLabel, attention, board, onOwner }: { node: TreeSubject; lateOnly: boolean; avgLabel: string; attention: React.ReactNode; board: React.ReactNode; onOwner: (ownerId: string, kind: string | null) => void }) {
  const rowsAll: MatrixRow[] = node.owners.map((o) => ({ ownerId: o.ownerId, name: o.name, meta: ownerMeta(o), cells: o.cells, all: o.cell }));
  const rows = lateOnly ? rowsAll.filter((r) => r.all.late) : rowsAll;
  return <div className="grid gap-4">
    <AdminKpiRow cell={node.cell} />
    <VerdictLine v={judge(node.cell)} />
    {board}
    {attention}
    <section className="border-line bg-card rounded-xl border p-2"><AdminMatrix rows={rows} total={foldMatrixRows(rows)} avg={{ pct: node.cell.pct, label: avgLabel }} onCell={onOwner} /></section>
  </div>;
}

/** 반 단계 — 그 반 · 그 담당의 집계(트리 줄과 같은 수) 한 번. 반 없는 의무(신규생 정착)는 반 조건 없이 그 담당의 집계에서 반 없는 줄만 · '담당 미정'은 담당자 없는 의무만. */
export function ClassPane({ period, tick, classNode, owner, fetchSubject, teacher, avg, kind, onStudent, onWork }: {
  period: AdminPeriod; tick: number; classNode: { classId: string; name: string; cell: MatrixRow["all"] }; owner: string; fetchSubject: string | null; teacher: string; avg: { pct: number | null; label: string } | null; kind: string | null; onStudent: (studentId: string, name: string) => void; onWork: (w: DutyWork) => void;
}) {
  const [pick, setPick] = useState<CellPick | null>(null);
  const classId = classNode.classId === NO_CLASS ? null : classNode.classId;
  const { data, failed } = useStudentsPayload(period, owner === NO_OWNER ? { classId, ownerNone: true, subject: fetchSubject } : { classId, owner, subject: fetchSubject }, tick);
  const label = (k: string | null) => (k ? MATRIX_COLUMNS.find((c) => c.kind === k)?.label ?? "업무" : "전체");
  return <>
    <ClassLevel cls={classNode} teacher={teacher} avg={avg} payload={data} failed={failed} kind={kind} onStudent={onStudent}
      onCell={(studentId, name, k) => setPick({ title: `${name} · ${label(k)}`, studentId, kind: k, classId, classNone: classId === null, owner: owner === NO_OWNER ? null : owner, ownerNone: owner === NO_OWNER, subject: fetchSubject })} />
    {pick ? <CellItemsDialog key={`${pick.studentId}|${pick.kind ?? ""}`} pick={pick} period={period} onClose={() => setPick(null)} onWork={onWork} /> : null}
  </>;
}

/** 학생 단계 — 그 학생의 집계(반·담당 불문 · 신규생 정착처럼 반 없는 의무도) 한 번. */
export function StudentPane({ period, tick, studentId, fetchSubject, late, nowMs, onWork }: {
  period: AdminPeriod; tick: number; studentId: string; fetchSubject: string | null; late: LateItem[]; nowMs: number; onWork: (w: DutyWork) => void;
}) {
  const { data } = useStudentsPayload(period, { studentId, subject: fetchSubject }, tick);
  return <StudentLevel studentId={studentId} payload={data} late={late} nowMs={nowMs} onWork={onWork} />;
}
