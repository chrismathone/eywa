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

/** 과목(또는 전체) 단계 — 요약 칸 넷 · 판정 · (전체 단계 · 학원 전체를 보는 사람) 과목 관리자별 현황 · 선생님 × 종류 표(전체 단계는 과목마다 하나씩 나란히 · 항목/과목 필터) + 그 옆에 미완료 · 기한 초과. */
export function SubjectLevel({ node, subjects = null, lateOnly, avgLabel, grade = true, attention, board, side = null, onOwner }: {
  node: TreeSubject; /** 전체 단계에서 과목마다 표를 나눠 세울 때의 과목들(과목 단계면 null). */ subjects?: readonly TreeSubject[] | null;
  lateOnly: boolean; avgLabel: string; grade?: boolean; /** 표 옆 칸의 맨 위(하루 보기의 미완료). */ side?: React.ReactNode; attention: React.ReactNode; board: React.ReactNode;
  onOwner: (ownerId: string, kind: string | null, subject?: string | null) => void;
}) {
  // 선생님 표의 필터 둘(원장 2026-11-11 *"필터를 2개로. 항목 / 과목"*) — 항목 = 한 종류만 · 과목 = 그 과목 선생님만. 과목을 안 고르면 과목마다 표를 나란히 세운다(*"과목별로 2단 분리"*).
  const [kind, setKind] = useState<string | null>(null);
  const [subjectKey, setSubjectKey] = useState<string | null | undefined>(undefined);
  const rowsOf = (s: TreeSubject): MatrixRow[] => { const all = s.owners.map((o): MatrixRow => ({ ownerId: o.ownerId, name: o.name, meta: ownerMeta(o), cells: o.cells, all: o.cell })); return lateOnly ? all.filter((r) => r.all.late) : all; };
  const groups = subjects && subjects.length > 1 ? subjects : [node];
  const pickedSubject = subjects?.some((s) => s.subject === subjectKey) ? subjectKey : undefined;
  const hidden = (s: TreeSubject) => subjects !== null && subjects.length > 1 && pickedSubject !== undefined && s.subject !== pickedSubject; // 과목 필터도 자리는 그대로 두고 감추기만 한다
  const kinds = MATRIX_COLUMNS.filter((c) => node.cells[c.kind]?.total);
  const picked = kind && kinds.some((c) => c.kind === kind) ? kind : null;
  const tallest = Math.max(0, ...groups.map((s) => rowsOf(s).length));
  const chip = (on: boolean) => `rounded-full border px-2.5 py-0.5 text-xs font-bold ${on ? "border-primary bg-primary text-primary-foreground" : "border-line text-text-dim hover:text-primary"}`;
  return <div className="grid gap-4">
    <AdminKpiRow cell={node.cell} />
    <VerdictLine v={judge(node.cell)} />
    {board}
    {/* 필터와 과목별 표를 한 카드에 — 표는 나란히(2단), 합계 줄은 같은 높이(원장 2026-11-11). */}
    <div className="flex flex-wrap items-start gap-4">
      <section className="border-line bg-card grid max-w-full flex-none gap-2 rounded-xl border p-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <span className="flex flex-wrap items-center gap-1.5"><span className="text-text-dim text-xs font-bold">항목</span>
            <button type="button" aria-pressed={picked === null} onClick={() => setKind(null)} className={chip(picked === null)}>전체</button>
            {kinds.map((c) => <button key={c.kind} type="button" aria-pressed={picked === c.kind} onClick={() => setKind(c.kind)} className={chip(picked === c.kind)}>{c.label}</button>)}
          </span>
          {subjects && subjects.length > 1 ? <span className="flex flex-wrap items-center gap-1.5"><span className="text-text-dim text-xs font-bold">과목</span>
            <button type="button" aria-pressed={pickedSubject === undefined} onClick={() => setSubjectKey(undefined)} className={chip(pickedSubject === undefined)}>전체</button>
            {subjects.map((s) => <button key={s.subject ?? ""} type="button" aria-pressed={pickedSubject === s.subject} onClick={() => setSubjectKey(s.subject)} className={chip(pickedSubject === s.subject)}>{s.label}</button>)}
          </span> : null}
        </div>
        <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
          {groups.map((s) => { const rows = rowsOf(s); return <div key={s.subject ?? ""} className={`max-w-full flex-none${hidden(s) ? " invisible" : ""}`} aria-hidden={hidden(s) || undefined}>
            <AdminMatrix rows={rows} total={foldMatrixRows(rows)} avg={{ pct: s.cell.pct, label: groups.length > 1 || subjects ? "과목" : avgLabel }} grade={grade} kind={picked} pad={Math.max(tallest - rows.length, 0)}
              title={subjects && subjects.length > 1 ? `${s.label} 선생님` : "선생님"} onCell={(ownerId, k) => onOwner(ownerId, k ?? picked, subjects && subjects.length > 1 ? s.subject : undefined)} />
          </div>; })}
        </div>
      </section>
      <div className="grid min-w-[min(100%,420px)] flex-1 gap-4">{side}{attention}</div>
    </div>
  </div>;
}

/** 반 단계 — 그 반 · 그 담당의 집계(트리 줄과 같은 수) 한 번. 반 없는 의무(신규생 정착)는 반 조건 없이 그 담당의 집계에서 반 없는 줄만 · '담당 미정'은 담당자 없는 의무만. */
export function ClassPane({ period, tick, classNode, owner, fetchSubject, teacher, avg, kind, aside, onStudent, onWork }: {
  aside?: React.ReactNode;
  period: AdminPeriod; tick: number; classNode: { classId: string; name: string; cell: MatrixRow["all"] }; owner: string; fetchSubject: string | null; teacher: string; avg: { pct: number | null; label: string } | null; kind: string | null; onStudent: (studentId: string, name: string) => void; onWork: (w: DutyWork) => void;
}) {
  const [pick, setPick] = useState<CellPick | null>(null);
  const classId = classNode.classId === NO_CLASS ? null : classNode.classId;
  const { data, failed } = useStudentsPayload(period, owner === NO_OWNER ? { classId, ownerNone: true, subject: fetchSubject } : { classId, owner, subject: fetchSubject }, tick);
  const label = (k: string | null) => (k ? MATRIX_COLUMNS.find((c) => c.kind === k)?.label ?? "업무" : "전체");
  return <>
    <ClassLevel cls={classNode} teacher={teacher} avg={avg} payload={data} failed={failed} kind={kind} grade={false} aside={aside} onStudent={onStudent}
      onCell={(studentId, name, k) => setPick({ title: `${name} · ${label(k)}`, studentId, kind: k, classId, classNone: classId === null, owner: owner === NO_OWNER ? null : owner, ownerNone: owner === NO_OWNER, subject: fetchSubject })} />
    {pick ? <CellItemsDialog key={`${pick.studentId}|${pick.kind ?? ""}`} pick={pick} period={period} tick={tick} onClose={() => setPick(null)} onWork={onWork} /> : null}
  </>;
}

/** 학생 단계 — 그 학생의 집계(반·담당 불문 · 신규생 정착처럼 반 없는 의무도) 한 번. */
export function StudentPane({ period, tick, studentId, fetchSubject, late, nowMs, onWork }: {
  period: AdminPeriod; tick: number; studentId: string; fetchSubject: string | null; late: LateItem[]; nowMs: number; onWork: (w: DutyWork) => void;
}) {
  const { data } = useStudentsPayload(period, { studentId, subject: fetchSubject }, tick);
  return <StudentLevel studentId={studentId} payload={data} late={late} nowMs={nowMs} onWork={onWork} />;
}
