"use client";

import { SheetText } from "@/features/teacher-view/interface-label";

import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { saveUnifiedGrade } from "@/features/grades/unified/server/actions";
import { schoolGradeLabel, type UnifiedRow } from "@/features/grades/unified/model";
import { examInfoOf } from "@/features/grades/unified/ledger-view";
import { GoalBadge } from "@/features/grades/components/goal-badge";
import type { GoalView } from "@/features/grades/goals";
import { DeltaBadge, KindPill, ScoreLine } from "./tab-parts";
import { TodaysMathChip } from "./todays-math-chip";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { SUBJECT_SOFT } from "@/features/owner/subjects";

const INPUT = "border-line min-w-0 rounded-md border bg-background px-1.5 py-1 text-sm text-center";
const BTN = "border-line hover:bg-bg-soft rounded-md border px-2 py-1 text-sm font-semibold whitespace-nowrap disabled:opacity-50";

/**
 * 원장 한 줄 — **기본은 읽기 전용**이고 [수정]을 눌러야 칸이 열린다(원장 2026-09-23 "기본적으로 수정 불가능").
 * [삭제]는 행을 지우지 않고 **점수를 비운다**(성적 행 삭제는 칸 비우기·학생 상세 휴지통 두 곳뿐 — grades-wiring 가드).
 *
 * 🔴 저장 요청은 **이 줄의 state로 직접** 만든다. 옛 줄은 입력칸을 `form=` 속성으로 숨은 폼에 묶었는데,
 *    날짜 칸이 요청에 실리지 않아 DB엔 멀쩡한 날짜가 있는데도 "시험일을 확인해 주세요"가 떴다(원장 제보 2026-09-23).
 */
function LedgerRow({ row, canWrite, goal, todaysMath }: { row: UnifiedRow; canWrite: boolean; goal?: GoalView; todaysMath?: boolean }) {
  const initialConsult = row.consultationDate ?? row.manualConsultationDate ?? "";
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [date, setDate] = useState(row.date);
  const [score, setScore] = useState(row.score == null ? "" : String(row.score));
  const [max, setMax] = useState(String(row.maxScore ?? 100));
  const [consulted, setConsulted] = useState(!!initialConsult);
  const [consultDate, setConsultDate] = useState(initialConsult);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const subjectMaps = useSubjectMaps();
  const reportDate = row.source === "report";
  const classNames = row.classes.map((cls) => cls.name).join(" / ");
  const teacherNames = [...new Set(row.classes.map((cls) => cls.teacher).filter(Boolean))].join(" / ");

  const send = (fields: { score: string; label: string }) => start(async () => {
    const fd = new FormData();
    fd.set("source", row.source); fd.set("id", row.sourceId); fd.set("kind", row.kind);
    fd.set("date", reportDate ? row.date : date);
    fd.set("score", fields.score); fd.set("maxScore", max);
    fd.set("originalConsultationDate", initialConsult);
    fd.set("consultationDate", consulted && !row.consultationDate ? consultDate : initialConsult);
    const result = await saveUnifiedGrade(undefined, fd);
    if (result?.error) { setMessage({ ok: false, text: result.error }); return; }
    setMessage({ ok: true, text: fields.label });
    setEditing(false); setConfirmDelete(false);
  });
  // 편집 칸은 **열 때마다 지금 행 값으로** 다시 채운다 — 저장 뒤 서버가 새 행을 내려줘도 state는 옛 값이라서.
  const reset = (open: boolean) => {
    setEditing(open); setDate(row.date); setScore(row.score == null ? "" : String(row.score));
    setMax(String(row.maxScore ?? 100)); setConsulted(!!initialConsult); setConsultDate(initialConsult); setMessage(null);
  };
  const cancel = () => reset(false);

  return (
    <tr className={`border-line-faint border-t align-middle ${editing ? "bg-primary-soft/30" : "hover:bg-muted/40"} ${row.score == null && !row.rawScore ? "bg-amber-soft/40" : ""}`}>
      <td className="px-2 py-2 text-center"><span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${SUBJECT_SOFT[subjectMaps.colorOf(row.subject)]}`}><SheetText value={subjectMaps.labelOf(row.subject)} /></span></td>
      <td className="px-2 py-2 text-center">
        {editing && !reportDate ? <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label={`${row.name} 시험일`} className={`${INPUT} w-full`} />
          : <span className="num" title={reportDate ? "수업보고서 날짜 — 날짜는 보고서에서 고칩니다" : undefined}>{row.date.slice(2).replaceAll("-", ".")}</span>}
      </td>
      <td className="px-2 py-2 text-center font-semibold"><Link href={`/students/${row.studentId}?tab=grades`} className="hover:text-primary hover:underline">{row.name}</Link></td>
      <td className="px-2 py-2 text-center">{schoolGradeLabel(row.school, row.grade)}</td>
      <td className="max-w-0 px-2 py-2" title={classNames}><span className="block truncate">{classNames || "—"}</span></td>
      <td className="max-w-0 px-2 py-2 text-center" title={teacherNames}><span className="block truncate">{teacherNames || "—"}</span></td>
      <td className="px-2 py-2 text-center"><KindPill kind={row.kind} /></td>
      <td className="px-2 py-2 text-center text-sm">{todaysMath ? <span className="inline-flex flex-wrap items-center justify-center gap-1">{examInfoOf(row)}<TodaysMathChip /></span>
        : examInfoOf(row) ?? <span className="text-text-dim">—</span>}</td>
      <td className="px-2 py-2 text-left">
        {editing ? <div className="flex items-center gap-1">
          <input type="number" min="0" step="0.01" value={score} onChange={(e) => setScore(e.target.value)} placeholder="점수" aria-label={`${row.name} 점수`} className={`${INPUT} w-16`} />
          <span>/</span>
          <input type="number" min="1" max="1000" step="0.01" value={max} onChange={(e) => setMax(e.target.value)} aria-label={`${row.name} 만점`} className={`${INPUT} w-16`} />
        </div> : <><ScoreLine row={row} />{goal ? <GoalBadge goal={goal} className="mt-0.5 flex" /> : null}</>}
      </td>
      <td className="py-2 pl-2 pr-4 text-right"><DeltaBadge row={row} /></td>
      <td className="px-2 py-2 text-center">
        {row.consultationDate ? <span className="text-green num" title="학생 상담 탭의 학습·성적 상담">{row.consultationDate.slice(5).replace("-", "/")}</span>
          : editing ? <span className="flex items-center justify-center gap-1">
            <input type="checkbox" checked={consulted} onChange={(e) => setConsulted(e.target.checked)} aria-label={`${row.name} 성적 상담`} />
            {consulted ? <input type="date" value={consultDate} onChange={(e) => setConsultDate(e.target.value)} aria-label={`${row.name} 상담일`} className={`${INPUT} w-28`} /> : null}
          </span>
          : initialConsult ? <span className="num">{initialConsult.slice(5).replace("-", "/")}</span> : <span className="text-text-dim">—</span>}
      </td>
      {/* 🔴 읽기 권한이면 [수정]·[삭제] 칸을 **통째로 그리지 않는다**(원장 2026-11-05 — 비활성 단추로 남기지 않는다, write-lock.ts).
          머리줄 '관리' 열·colgroup도 같은 `canWrite`로 함께 뺀다(LedgerHead · 아래 UnifiedLedger). */}
      {canWrite ? <td className="px-2 py-2 text-center">
        <div className="flex items-center justify-center gap-1">
          {editing ? <>
            <button type="button" className={`${BTN} bg-primary text-primary-foreground border-primary`} disabled={pending || (consulted && !row.consultationDate && !consultDate)}
              onClick={() => send({ score, label: "저장됨" })}><SheetText value={pending ? "저장 중" : "저장"} /></button>
            <button type="button" className={BTN} disabled={pending} onClick={cancel}><SheetText value={"취소"} /></button>
          </> : confirmDelete ? <>
            <button type="button" className={`${BTN} border-danger text-danger`} disabled={pending} onClick={() => send({ score: "", label: "점수를 지웠습니다" })}><SheetText value={pending ? "지우는 중" : "지우기"} /></button>
            <button type="button" className={BTN} disabled={pending} onClick={() => setConfirmDelete(false)}><SheetText value={"취소"} /></button>
          </> : <>
            <button type="button" className={BTN} onClick={() => reset(true)}><SheetText value={"수정"} /></button>
            <button type="button" className={`${BTN} text-danger`} disabled={row.score == null && !row.rawScore}
              title="이 기록의 점수를 지웁니다" onClick={() => { setConfirmDelete(true); setMessage(null); }}><SheetText value={"삭제"} /></button>
          </>}
        </div>
        {confirmDelete ? <span className="text-danger mt-1 block text-xs"><SheetText value={"점수를 지울까요?"} /></span> : null}
        {message ? <span role={message.ok ? "status" : "alert"} className={`mt-1 block text-xs ${message.ok ? "text-green" : "text-danger"}`}>{message.text}</span> : null}
      </td> : null}
    </tr>
  );
}

export function UnifiedLedger({ rows, canWrite, head, goals = {}, todaysMathKeys = [] }: {
  rows: UnifiedRow[]; canWrite: boolean; head: ReactNode;
  /** 오늘 수학 채점 결과와 같은 값인 줄 key(서버 `loadTodaysMathMarks`) — 시험정보에 '오늘 수학' 표시. */
  todaysMathKeys?: string[];
  /** 줄 key → 시험 목표 대비(서버 `goalViewsForRows`). 목표가 없는 줄은 비어 있다. */
  goals?: Record<string, GoalView>;
}) {
  const marked = new Set(todaysMathKeys);
  return (
    // 열 머리 필터 팝업이 짧은 표에서 잘리지 않게 최소 높이를 둔다(overflow 컨테이너 안 absolute 팝업 — header-filter 주석).
    <div className="bg-card shadow-card min-h-[26rem] overflow-x-auto rounded-2xl">
      <table className="w-full min-w-[1360px] table-fixed text-sm">
        <colgroup>
          <col className="w-[5.5rem]" /><col className="w-[7.75rem]" /><col className="w-[6rem]" /><col className="w-[7rem]" /><col />
          <col className="w-[8rem]" /><col className="w-[7rem]" /><col className="w-[10.5rem]" /><col className="w-[12.5rem]" /><col className="w-[6.5rem]" />
          <col className="w-[7.5rem]" />{canWrite ? <col className="w-[8.5rem]" /> : null}
        </colgroup>
        {head}
        <tbody>{rows.map((row) => <LedgerRow key={row.key} row={row} canWrite={canWrite} goal={goals[row.key]} todaysMath={marked.has(row.key)} />)}</tbody>
      </table>
      {rows.length === 0 ? <p className="text-text-dim p-8 text-center text-sm"><SheetText value={"조건에 맞는 성적 기록이 없습니다. 필터나 검색어를 바꿔 보세요."} /></p> : null}
    </div>
  );
}
