"use client";

import { useState } from "react";
import { foldMatrixRows, hasProgressCell, MATRIX_COLUMNS, missedOf, type AdminPeriod, type LateItem, type MatrixRow } from "../../view-admin";
import { CellItemsDialog, type CellPick } from "./admin-cell-items";
import type { WithdrawalPick } from "./admin-withdrawal-items";
import { judge, NO_CLASS, NO_OWNER, ownerMeta, type TreeSubject } from "../../view-admin-levels";
import type { DutyWork } from "../duty-work-context";
import { AdminKpiRow } from "./admin-subject";
import { AdminMatrix, tableBasis } from "./admin-matrix";
import { MixLegend } from "./admin-mix";
import { VerdictLine } from "./admin-verdict";
import { ClassLevel } from "./admin-level-class";
import { StudentLevel } from "./admin-level-student";
import { useStudentsPayload } from "./use-students";
import { MultiPick } from "./admin-multi-pick";

/** 과목(또는 전체) 단계 — 요약 칸 넷 · 판정 · (전체 단계 · 학원 전체를 보는 사람) 과목 관리자별 현황 · 선생님 × 종류 표(전체 단계는 과목마다 하나씩 위아래로 · 항목/과목 필터) + 그 옆(자리가 모자라면 아래)에 미완료 · 기한 초과. */
export function SubjectLevel({ node, subjects = null, lateOnly, avgLabel, grade = true, attention, board, side = null, onOwner, onWithdrawal }: {
  node: TreeSubject; /** 전체 단계에서 과목마다 표를 나눠 세울 때의 과목들(과목 단계면 null). */ subjects?: readonly TreeSubject[] | null;
  lateOnly: boolean; avgLabel: string; grade?: boolean; /** 표 옆 칸의 맨 위(하루 보기의 미완료). */ side?: React.ReactNode; attention: React.ReactNode; board: React.ReactNode;
  onOwner: (ownerId: string, kind: string | null, subject?: string | null) => void;
  /** 퇴원보고서 작성(참고 열) 칸을 눌렀을 때 — 그 선생님 · 그 과목(전체 단계 한 표면 null)의 작성 차례 목록. */
  onWithdrawal: (pick: WithdrawalPick) => void;
}) {
  // 선생님 표의 필터 둘(원장 2026-11-11 *"필터를 2개로. 항목 / 과목"*) — 항목 = 고른 종류만 · 과목 = 고른 과목 선생님만. 과목을 안 고르면 과목마다 표를 나란히 세운다(*"과목별로 2단 분리"*).
  //   둘 다 드롭다운 하나에 여럿을 고른다(원장 2026-11-12 — 칩 나열을 걷었다 · `MultiPick`). 빈 목록 = 전체.
  const [kindKeys, setKindKeys] = useState<string[]>([]);
  const [subjectKeys, setSubjectKeys] = useState<(string | null)[]>([]);
  const rowsOf = (s: TreeSubject): MatrixRow[] => { const all = s.owners.map((o): MatrixRow => ({ ownerId: o.ownerId, name: o.name, meta: ownerMeta(o), cells: o.cells, all: o.cell, rating: o.rating, withdrawal: o.withdrawal, video: o.video })); return lateOnly ? all.filter((r) => missedOf(r.all)) : all; };
  const groups = subjects && subjects.length > 1 ? subjects : [node];
  const pickedSubjects = subjects ? subjectKeys.filter((k) => subjects.some((s) => s.subject === k)) : [];
  const hidden = (s: TreeSubject) => subjects !== null && subjects.length > 1 && pickedSubjects.length > 0 && !pickedSubjects.includes(s.subject); // 과목 필터도 자리는 그대로 두고 감추기만 한다
  const kinds = MATRIX_COLUMNS.filter((c) => node.cells[c.kind]?.total);
  const shown = kindKeys.filter((k) => kinds.some((c) => c.kind === k));
  // 칸 목록을 열 때 넘길 종류 — 하나만 골랐으면 그 종류(전체 칸을 눌러도 그 종류의 목록), 아니면 전체.
  const picked = shown.length === 1 ? shown[0]! : null;
  // 열은 여기서 한 번 정한다 — 과목마다 표를 나눠 세워도 열(종류 · 평점)이 같아야 세로줄이 맞는다.
  const rated = node.owners.some((o) => o.rating);
  // 퇴원보고서 작성(참고 열) — 보이는 표 어느 하나에라도 있으면 모든 표에 세운다(세로줄이 맞게).
  const withdrawalCol = groups.some((s) => s.owners.some((o) => o.withdrawal));
  // 영상 숙제(참고 열 · s2_0094) — 같은 규칙.
  const videoCol = groups.some((s) => s.owners.some((o) => o.video?.issued));
  return <div className="grid grid-cols-1 gap-4">
    <AdminKpiRow cell={node.cell} />
    <VerdictLine v={judge(node.cell)} />
    {board}
    {/* 표 카드 + 옆 카드(미완료 · 기한 초과) — 표가 편하게 서는 폭(`tableBasis`)과 옆 카드가 한 줄에 들어가면 나란히, 아니면 표가 한 줄을 다 쓰고 옆 카드는 아래로.
        표는 늘 카드 폭을 채우고 과목 표는 위아래로 선다(열이 같아 세로줄이 맞는다). */}
    <div className="flex flex-wrap items-start gap-4">
      <section className="border-line bg-card grid max-w-full min-w-0 grow grid-cols-1 gap-3 rounded-xl border p-3" style={{ flexBasis: tableBasis(kinds.length + 1 + (rated ? 1 : 0) + (withdrawalCol ? 1 : 0) + (videoCol ? 1 : 0), grade) }}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <MultiPick label="항목" options={kinds.map((c) => ({ key: c.kind, label: c.label }))} value={shown} onChange={setKindKeys} />
          {subjects && subjects.length > 1 ? <MultiPick label="과목" options={subjects.map((s) => ({ key: s.subject, label: s.label }))} value={pickedSubjects} onChange={setSubjectKeys} /> : null}
          <MixLegend className="ml-auto" progress={hasProgressCell(groups.filter((s) => !hidden(s)).flatMap((s) => rowsOf(s)).flatMap((r) => (shown.length ? shown : kinds.map((c) => c.kind)).map((k) => r.cells[k])))} />
        </div>
        {groups.map((s) => { const rows = rowsOf(s); return <div key={s.subject ?? ""} className={hidden(s) ? "invisible" : undefined} aria-hidden={hidden(s) || undefined}>
          <AdminMatrix rows={rows} total={foldMatrixRows(rows)} avg={{ pct: s.cell.pct, label: groups.length > 1 || subjects ? "과목" : avgLabel }} grade={grade} shown={shown.length ? shown : null} columns={kinds} rated={rated} video={videoCol}
            withdrawal={withdrawalCol ? (ownerId) => onWithdrawal({ owner: ownerId, name: rows.find((r) => r.ownerId === ownerId)?.name ?? "선생님", subject: groups.length > 1 || subjects ? s.subject : node.subject }) : undefined}
            title={subjects && subjects.length > 1 ? `${s.label} 선생님` : "선생님"} onCell={(ownerId, k) => onOwner(ownerId, k ?? picked, subjects && subjects.length > 1 ? s.subject : undefined)} />
        </div>; })}
      </section>
      {/* 옆 카드(미처리) — 좁게(원장 2026-11-12 *"우측 미처리 열을 좀 더 줄이고"*): 남는 폭을 표와 나눠 갖는다(예전엔 남는 폭을 거의 다 가져갔다). */}
      <div className="grid min-w-[min(100%,320px)] [flex:1_1_320px] grid-cols-1 content-start gap-4">{side}{attention}</div>
    </div>
  </div>;
}

/** 반 단계 — 그 반 · 그 담당의 집계(트리 줄과 같은 수) 한 번. 반 없는 의무(신규생 정착)는 반 조건 없이 그 담당의 집계에서 반 없는 줄만 · '담당 미정'은 담당자 없는 의무만. */
export function ClassPane({ period, tick, classNode, owner, fetchSubject, teacher, kind, aside, onStudent, onWork }: {
  aside?: React.ReactNode;
  period: AdminPeriod; tick: number; classNode: { classId: string; name: string; cell: MatrixRow["all"] }; owner: string; fetchSubject: string | null; teacher: string; kind: string | null; onStudent: (studentId: string, name: string) => void; onWork: (w: DutyWork) => void;
}) {
  const [pick, setPick] = useState<CellPick | null>(null);
  const classId = classNode.classId === NO_CLASS ? null : classNode.classId;
  const { data, failed } = useStudentsPayload(period, owner === NO_OWNER ? { classId, ownerNone: true, subject: fetchSubject } : { classId, owner, subject: fetchSubject }, tick);
  const label = (k: string | null) => (k ? MATRIX_COLUMNS.find((c) => c.kind === k)?.label ?? "업무" : "전체");
  return <>
    <ClassLevel cls={classNode} teacher={teacher} payload={data} failed={failed} kind={kind} grade={false} aside={aside} onStudent={onStudent}
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
