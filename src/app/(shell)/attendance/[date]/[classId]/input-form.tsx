"use client";

import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  AlertCircle,
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  Loader2,
  Pencil,
  RotateCcw,
  Save,
  X,
} from "@/components/icons/aywa-icon-compat";
import { Button } from "@/components/ui/button";
import {
  saveAttendance,
  type SaveAttendanceState,
} from "@/features/attendance/server/actions";
import type {
  AttendanceInputRow,
  AttendanceStatus,
} from "@/features/attendance/server/queries";
import { slotBreakdown } from "@/features/attendance/cell-display";
import { formatSessionUnits } from "@/features/attendance/session-units";
import { submitAction } from "@/components/forms/submit-action";
import {
  MakeupConfirmDialog,
  type MakeupConfirmChoice,
} from "@/features/attendance/components/makeup-confirm-dialog";
import { fetchMakeupAbsences } from "@/features/attendance/server/makeup-actions";
import type { MakeupAbsenceList } from "@/features/attendance/makeup-options";
import { AttendanceMakeupAdder, type MakeupPick } from "./makeup-adder";
import {
  RESERVED_BADGE_CLASS,
  RESERVED_CELL_LABEL,
  reservationTitle,
} from "@/features/attendance/makeup-reservation";

const STATUS_DEFS: {
  value: AttendanceStatus;
  label: string;
  icon: typeof Check;
  activeClass: string;
}[] = [
  {
    value: "present",
    label: "출석",
    icon: Check,
    activeClass: "text-primary bg-primary/10 border-primary/30",
  },
  {
    value: "absent",
    label: "결석",
    icon: X,
    activeClass: "text-danger bg-danger/10 border-danger/30",
  },
  {
    value: "late",
    label: "지각",
    icon: Clock,
    activeClass: "text-amber bg-amber/10 border-amber/30",
  },
  {
    value: "early_leave",
    label: "조퇴",
    icon: Clock,
    activeClass: "text-rose bg-rose/10 border-rose/30",
  },
  {
    value: "makeup",
    label: "보강",
    icon: RotateCcw,
    activeClass: "text-purple bg-purple/10 border-purple/30",
  },
];

/** 아직 안 불러왔을 때의 빈 한 벌 — 확인창은 이걸 받아 '직접 입력'만 보여 준다. */
const EMPTY_ABSENCES: MakeupAbsenceList = { options: [], hiddenBySubject: 0 };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
      저장
    </Button>
  );
}

type CellState = {
  status: AttendanceStatus | null;
  note: string;
  homeworkRequired: boolean;
  homeworkDone: boolean;
  // 시수(정규 1회 기준 배수) raw 입력 — ""=기본 1. 서버(parseSessionUnits)에서 검증.
  units: string;
  expanded: boolean;
};

function unitsToDraft(sessionUnits: number | null): string {
  return sessionUnits === null || sessionUnits === 1 ? "" : formatSessionUnits(sessionUnits);
}

export function AttendanceInputForm({
  classId,
  date,
  rows,
  locked,
  autoUnits,
}: {
  classId: string;
  date: string;
  rows: AttendanceInputRow[];
  /** 수정 기간(7일)이 지나 강사가 못 고치는 날 — 입력·저장을 전부 잠근다. */
  locked?: boolean;
  /**
   * 이 반·날짜 **수학 자동 시수**(수업 길이, auto-units.ts · 원장 2026-09-11) — 기록 없는 학생을 시수 칸
   * 비운 채 저장하면 서버가 넣는 값이라 그 칸의 기본값(placeholder)으로 보여 준다. null = 빈 칸은 1.
   */
  autoUnits?: number | null;
}) {
  const [state, formAction] = useActionState<SaveAttendanceState, FormData>(saveAttendance, undefined);
  // 이번 화면에서 새로 추가한 보강 학생(아직 저장 전) — 저장되면 서버 rows에 isMakeup으로 합류한다.
  const [added, setAdded] = useState<AttendanceInputRow[]>([]);
  const allRows = [...rows, ...added];
  const [pending, setPending] = useState<Record<string, CellState>>(() => {
    const init: Record<string, CellState> = {};
    for (const r of rows) {
      const units = unitsToDraft(r.sessionUnits);
      init[r.studentId] = {
        status: r.status,
        note: r.note ?? "",
        homeworkRequired: r.homeworkRequired,
        homeworkDone: r.homeworkDone,
        units,
        expanded: !!(r.note || r.homeworkRequired || units),
      };
    }
    return init;
  });

  /**
   * 보강 추가는 **여기서도 확인창을 거친다**(원스크린·ECS와 같은 질문 — 원장 2026-08-19 *"항상 묻도록"*).
   *
   * 🔴 두 화면과 **저장 모델이 다르다**: 저기는 고르는 즉시 서버에 칸을 열고, 이 화면은 폼을 제출할 때
   *    한 번에 쓴다. 그래서 여기서 즉시 저장을 부르면 아래 '취소'가 거짓말이 되고(이미 저장됨) 폼의
   *    미저장 편집과 서버 상태가 갈린다. → 고른 결과는 **hidden으로 실어** `saveAttendance`가 저장
   *    직후 같은 자리에서 잇는다(연결 액션은 세 화면이 공유하는 `noteMakeupAgainstAbsence`).
   */
  const [makeupPick, setMakeupPick] = useState<MakeupPick | null>(null);
  const [absences, setAbsences] = useState<MakeupAbsenceList>(EMPTY_ABSENCES);
  const [absencesLoading, setAbsencesLoading] = useState(false);
  /** studentId → "결석반id|결석일" — 폼과 함께 보내는 결석분 연결(고른 사람만). */
  const [makeupLinks, setMakeupLinks] = useState<Record<string, string>>({});
  /** 결석 조회 응답 순서 가드 — 늦게 온 옛 조회가 최신 창을 덮지 않게. */
  const absenceSeq = useRef(0);

  function openMakeupConfirm(picked: MakeupPick) {
    if (allRows.some((r) => r.studentId === picked.id)) return;
    setMakeupPick(picked);
    setAbsences(EMPTY_ABSENCES);
    setAbsencesLoading(true);
    // 🔴 **어느 학생의 응답인지 확인하고 반영한다** — 취소하고 다른 학생을 열면 먼저 띄운 조회가 늦게
    //    도착해 **남의 결석 이력**이 이 학생 것처럼 뜬다(옆 파일 makeup-adder가 같은 이유로 seq를 쓴다).
    const mine = ++absenceSeq.current;
    // 창은 먼저 열고 목록만 갈아 끼운다 — 조회를 기다리며 멈춰 있으면 "눌러도 반응 없다"가 된다.
    // 🔴 **이 반의 과목**으로 후보를 좁힌다 — 수학 반 보강인데 영어 결석이 뜨면 잘못 골라 그 칸에
    //    메모가 간다(원장 제보 2026-08-19). 과목은 서버가 이 반 id로 읽는다(클라가 정하지 않는다).
    void fetchMakeupAbsences(picked.id, date, classId)
      .then((list) => {
        if (mine !== absenceSeq.current) return;
        setAbsences(list);
      })
      .catch(() => {
        if (mine !== absenceSeq.current) return;
        setAbsences(EMPTY_ABSENCES);
      })
      .finally(() => {
        if (mine !== absenceSeq.current) return;
        setAbsencesLoading(false);
      });
  }

  function confirmMakeup(choice: MakeupConfirmChoice) {
    const picked = makeupPick;
    setMakeupPick(null);
    if (!picked) return;
    addMakeup(picked, choice);
  }

  // 보강 학생 추가 — 기본 상태를 '보강'으로 찍어 둔다(그 학생은 온 게 확실하니 한 번 더 누르게 하지 않는다).
  // 이미 명단에 있으면(정규 수강생이거나 이미 추가함) 중복 행을 만들지 않는다.
  function addMakeup(s: MakeupPick, choice?: MakeupConfirmChoice) {
    if (allRows.some((r) => r.studentId === s.id)) return;
    // 확인창에서 고른 시수 — 🔴 1도 **명시**("1")로 싣는다(2026-09-11). 빈 칸은 '기본'이라 수학 반에선 서버가
    //    수업 길이 자동 시수(auto-units.ts)를 넣어, 확인창이 보여 준 숫자와 기록이 갈린다. "1"은 null로 저장된다.
    const unitsDraft = choice ? formatSessionUnits(choice.addUnits) : "";
    if (choice?.absentDate) {
      setMakeupLinks((prev) => ({
        ...prev,
        [s.id]: `${choice.absentClassId ?? classId}|${choice.absentDate}`,
      }));
    }
    setAdded((prev) => [
      ...prev,
      {
        studentId: s.id,
        studentName: s.name,
        studentGrade: s.label || null,
        enrollmentId: null,
        isMakeup: true,
        // 아직 저장 전이라 기록이 없다 — 저장하면 서버 rows에 교시 정보와 함께 합류한다.
        recordIds: [],
        existingRecordId: null,
        status: "makeup",
        note: null,
        homeworkRequired: false,
        homeworkDone: false,
        sessionUnits: null,
        slotCount: 0,
        slots: [],
      },
    ]);
    setPending((p) => ({
      ...p,
      [s.id]: {
        status: "makeup",
        note: "",
        homeworkRequired: false,
        homeworkDone: false,
        units: unitsDraft,
        // 1은 기본과 같은 값이라 펼치지 않는다(명시로 싣는 건 자동 시수를 막으려는 것뿐이다).
        expanded: !!choice && choice.addUnits !== 1,
      },
    }));
  }

  // 저장 전 보강 행 취소 — 서버에 이미 기록이 있는 행(isMakeup이어도)은 이 목록에 없으니 안전하다.
  function removeAdded(studentId: string) {
    setAdded((prev) => prev.filter((r) => r.studentId !== studentId));
    // 행을 접으면 연결도 함께 사라져야 한다 — 남으면 없는 학생의 결석분을 저장이 잇는다.
    setMakeupLinks((prev) => {
      if (!(studentId in prev)) return prev;
      const next = { ...prev };
      delete next[studentId];
      return next;
    });
  }

  function patchOne(studentId: string, patch: Partial<CellState>) {
    setPending((p) => ({ ...p, [studentId]: { ...p[studentId], ...patch } }));
  }

  function setOne(studentId: string, status: AttendanceStatus | null) {
    patchOne(studentId, { status });
  }

  // ⚠️ '전체 출석'은 **정규 명단만** 바꾼다 — 보강 행까지 '출석'으로 덮으면 보강이 정규 출석으로 둔갑해
  // 시수·완료율 판정이 흐려진다(보강은 개별로 남긴다).
  function setAll(status: AttendanceStatus) {
    setPending((p) => {
      const next = { ...p };
      for (const r of rows) {
        if (r.isMakeup) continue;
        next[r.studentId] = { ...next[r.studentId], status };
      }
      return next;
    });
  }

  function clearAll() {
    setPending((p) => {
      const next = { ...p };
      for (const r of allRows) {
        next[r.studentId] = {
          ...next[r.studentId],
          status: null,
          note: "",
          homeworkRequired: false,
          homeworkDone: false,
          units: "",
        };
      }
      return next;
    });
  }

  const dirty =
    added.length > 0 ||
    rows.some((r) => {
      const c = pending[r.studentId];
      return (
        c.status !== r.status ||
        c.note !== (r.note ?? "") ||
        c.homeworkRequired !== r.homeworkRequired ||
        c.homeworkDone !== r.homeworkDone ||
        c.units !== unitsToDraft(r.sessionUnits)
      );
    });
  // 진행 표시는 **정규 명단 기준** — 보강은 예정 인원이 아니라 분모에 넣으면 완료율이 흐려진다
  // (서버 처리현황 expected와 같은 규약).
  const roster = rows.filter((r) => !r.isMakeup);
  const filled = roster.filter((r) => pending[r.studentId]?.status != null).length;

  return (
    <form onSubmit={(e) => submitAction(e, formAction)} className="space-y-4">
      {/* 잠금은 fieldset 하나로 — 컨트롤을 하나씩 disabled 처리하면 새 입력이 생길 때마다 빠뜨린다.
          ⚠️ 진짜 게이트는 서버 액션(saveAttendance)이다(#77). 여기선 헛수고를 없앨 뿐.
          🔴 간격(`space-y-4`)은 **fieldset이** 준다 — 일괄 바·명단·저장 줄이 전부 이 안이라 form의 `space-y-4`는 안 먹고
             블록이 0px로 붙었다(2026-07-22 fieldset 도입 때의 퇴행). `min-w-0` = fieldset 기본 최소 폭(min-content)이
             좁은 창에서 명단을 가로로 밀어내지 않게. hidden input은 display:none이라 간격에 끼지 않는다. */}
      <fieldset disabled={locked} className={`min-w-0 space-y-4 ${locked ? "opacity-60" : ""}`}>
      <input type="hidden" name="classId" value={classId} />
      <input type="hidden" name="date" value={date} />

      {/* Bulk actions */}
      <div className="border-line bg-card flex flex-wrap items-center justify-between gap-2 rounded-2xl border px-4 py-2.5">
        <div className="text-text-dim text-xs">
          입력 <span className="num">{filled}</span> / <span className="num">{roster.length}</span>
          {allRows.length > roster.length ? (
            <span className="text-text-faint">
              {" "}
              · 보강 <span className="num">{allRows.length - roster.length}</span>명
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setAll("present")}
            className="text-primary hover:bg-primary/10 rounded-lg px-2 py-1 text-xs font-medium transition"
          >
            전체 출석
          </button>
          <span className="text-text-dim/40 text-xs">·</span>
          <button
            type="button"
            onClick={clearAll}
            className="text-text-dim hover:text-foreground rounded-lg px-2 py-1 text-xs transition"
          >
            전체 초기화
          </button>
          <span className="text-text-dim/40 text-xs">·</span>
          <AttendanceMakeupAdder classId={classId} date={date} disabled={locked} onAdd={openMakeupConfirm} />
        </div>
      </div>

      {allRows.length === 0 ? (
        <div className="border-line bg-bg-soft/20 rounded-2xl border border-dashed p-8 text-center">
          <p className="text-text-dim text-sm">이 날짜에 등원하는 학생이 없습니다.</p>
          <p className="text-text-faint mt-1 text-xs break-keep">
            보강으로 온 학생이 있으면 위 &lsquo;+ 보강 학생 추가&rsquo;로 출결을 남길 수 있습니다.
          </p>
        </div>
      ) : (
        <ul className="bg-card border-line divide-border divide-y rounded-2xl border">
          {allRows.map((r) => {
            const cell = pending[r.studentId];
            const hasExtra = !!(cell.note || cell.homeworkRequired);
            return (
              <li key={r.studentId} className="px-5 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  {/* 🔑 이름·학년은 **열로 읽히게** 최소 너비를 준다 — 이름 길이가 제각각이면(동명이인
                      접미사 한 글자에도) 학년이 행마다 다른 자리에서 시작해 표가 흔들린다. 자르지는
                      않는다(이름은 잘리면 안 되는 값 [[#111]]) — 긴 이름은 그 행만 밀린다. */}
                  <div className="flex items-center gap-3">
                    {/* 너비는 **바깥 칸**이 갖는다 — 링크에 직접 주면 이름 옆 빈 자리를 눌러도
                        학생 상세가 새 탭으로 열린다(누른 적 없는 곳이 눌리는 셈). */}
                    <span className="min-w-[92px]">
                      <Link
                        href={`/students/${r.studentId}`}
                        target="_blank"
                        className="text-foreground text-sm font-medium hover:underline inline-flex items-center gap-1"
                        title={`${r.studentName} 학생 상세로 이동 (새 탭)`}
                      >
                        {r.studentName}
                        <ExternalLink className="text-text-dim size-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </Link>
                    </span>
                    {/* 학년이 없는 학생도 칸은 남긴다 — 안 그러면 그 행만 배지가 앞으로 당겨진다. */}
                    <span className="text-text-dim min-w-[64px] text-xs">{r.studentGrade ?? ""}</span>
                    {/* 보강 = 이 반 수강생이 아님. 표식이 없으면 명단에 섞여 "이 반 학생"으로 오인된다. */}
                    {/* 수업 나누기(0351a) — 받는 반(in)이면 '보강' 대신 '나눔'으로 선다(이 시간 출결이 이 반 몫).
                        원래 반(out)이면 학생은 그대로 두고 그 시간이 다른 반이라는 것만 알린다. */}
                    {r.split ? (
                      <span
                        className={`rounded-full border px-1.5 py-0.5 text-xs font-medium ${
                          r.split.dir === "in" ? "bg-blue-soft text-blue border-blue/30" : "bg-bg-soft text-text-dim border-line"
                        }`}
                        title={
                          r.split.dir === "in"
                            ? `${r.split.note} — 수업 나누기로 이 시간만 이 반에서 수업합니다(수강료·보고서는 원래 반)`
                            : `${r.split.note} — 이 시간은 다른 반에서 수업합니다(그 시간 출결은 그 반 출석부에서)`
                        }
                      >
                        {r.split.dir === "in" ? "나눔" : "일부 다른 반"}
                        <span className="num ml-1 font-normal">{r.split.note.replace(/^나눔 /, "")}</span>
                      </span>
                    ) : null}
                    {r.isMakeup && r.split?.dir !== "in" ? (
                      <span
                        className="bg-purple/10 text-purple border-purple/20 rounded-full border px-1.5 py-0.5 text-xs font-medium"
                        title="이 반 수강생이 아닌 보강(수업외) 참석 — 처리현황 '예정' 인원에는 포함되지 않습니다"
                      >
                        보강
                      </span>
                    ) : null}
                    {/* 보강 예약(0264a) — 미리 잡아 둔 보강. 출결을 찍으면 예약은 서버가 이행 처리한다(따로 누를 것 없음). */}
                    {r.reserved ? (
                      <span
                        className={`rounded-full border border-dashed border-purple/40 px-1.5 py-0.5 text-xs font-medium ${RESERVED_BADGE_CLASS}`}
                        title={reservationTitle({ ...r.reserved, makeupDate: date })}
                      >
                        {RESERVED_CELL_LABEL}
                        <span className="num ml-1 font-normal">
                          {r.reserved.periodLabel ? `${r.reserved.periodLabel} ` : ""}
                          {r.reserved.slotStart}
                        </span>
                      </span>
                    ) : null}
                    {r.existingRecordId ? (
                      <span className="text-text-dim text-xs">· 이전 기록 있음</span>
                    ) : null}
                    {/* 하루에 교시가 둘 이상인 학생(0196a) — 이 화면은 학생당 한 줄이라 접어서 보여 준다.
                        접었다는 사실과 무엇을 접었는지를 밝히지 않으면 "왜 시수가 2지?"로만 남는다. */}
                    {r.slotCount > 1 ? (
                      <span
                        className="bg-bg-soft text-text-dim border-line rounded-full border px-1.5 py-0.5 text-xs font-medium"
                        title={`${slotBreakdown(r.slots)} — 저장하면 이 날 ${r.slotCount}개 교시가 모두 같은 상태가 됩니다. 교시별로 다르게 두려면 영어 수업 시트에서 고치세요.`}
                      >
                        {r.slotCount}교시
                      </span>
                    ) : null}
                    {/* 저장 전 취소 — 서버에 이미 기록이 있는 보강 행은 여기 안 걸린다(그건 상태를 지워 반영). */}
                    {added.some((a) => a.studentId === r.studentId) ? (
                      <button
                        type="button"
                        onClick={() => removeAdded(r.studentId)}
                        className="text-text-faint hover:text-danger rounded-md p-0.5 transition"
                        aria-label={`${r.studentName} 보강 행 취소`}
                        title="추가 취소"
                      >
                        <X className="size-3" />
                      </button>
                    ) : null}
                    {hasExtra ? (
                      <span className="bg-purple/10 text-purple border-purple/20 inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs">
                        {cell.note ? <Pencil className="size-2.5" /> : null}
                        {cell.homeworkRequired ? <BookOpen className="size-2.5" /> : null}
                        {cell.units ? <span className="num font-bold">{cell.units}</span> : null}
                      </span>
                    ) : null}
                  </div>

                  {/* 그날 유효 기록 **전부**(쉼표) — 교시가 여럿이면 저장이 전 교시를 함께 고친다. */}
                  <input
                    type="hidden"
                    name={`existing:${r.studentId}`}
                    value={r.recordIds.join(",")}
                  />
                  {/* 서버 에러 메시지용 학생 이름(시수 검증 실패 시 누구인지 표시) */}
                  <input type="hidden" name={`name:${r.studentId}`} value={r.studentName} />
                  <input type="hidden" name={`units:${r.studentId}`} value={cell.units} />
                  {/* 결석분 연결 — 확인창에서 고른 경우만. 저장이 끝난 뒤 서버가 두 칸에 메모를 잇는다. */}
                  {makeupLinks[r.studentId] ? (
                    <input
                      type="hidden"
                      name={`makeupLink:${r.studentId}`}
                      value={makeupLinks[r.studentId]}
                    />
                  ) : null}
                  <input
                    type="hidden"
                    name={`status:${r.studentId}`}
                    value={cell.status ?? ""}
                  />
                  <input
                    type="hidden"
                    name={`note:${r.studentId}`}
                    value={cell.note}
                  />
                  <input
                    type="hidden"
                    name={`homeworkRequired:${r.studentId}`}
                    value={cell.homeworkRequired ? "true" : "false"}
                  />
                  <input
                    type="hidden"
                    name={`homeworkDone:${r.studentId}`}
                    value={cell.homeworkDone ? "true" : "false"}
                  />

                  <div className="inline-flex flex-wrap items-center justify-end gap-1">
                    {STATUS_DEFS.map((s) => {
                      const Icon = s.icon;
                      const active = cell.status === s.value;
                      return (
                        <button
                          key={s.value}
                          type="button"
                          onClick={() =>
                            setOne(r.studentId, active ? null : s.value)
                          }
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-medium transition ${
                            active
                              ? s.activeClass
                              : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft/30"
                          }`}
                          aria-pressed={active}
                        >
                          <Icon className="size-3" />
                          {s.label}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => patchOne(r.studentId, { expanded: !cell.expanded })}
                      className="text-text-dim hover:text-foreground ml-1 inline-flex size-6 items-center justify-center rounded-md"
                      aria-label={cell.expanded ? "접기" : "메모/숙제 펼치기"}
                    >
                      {cell.expanded ? (
                        <ChevronUp className="size-3" />
                      ) : (
                        <ChevronDown className="size-3" />
                      )}
                    </button>
                  </div>
                </div>

                {cell.expanded ? (
                  <div className="bg-bg-soft/30 border-line mt-2 space-y-2 rounded-md border p-2.5">
                    <div className="flex items-start gap-2">
                      <Pencil className="text-text-dim mt-1.5 size-3" />
                      <input
                        type="text"
                        value={cell.note}
                        onChange={(e) => patchOne(r.studentId, { note: e.target.value })}
                        placeholder="메모 (오늘의 특이사항 등)"
                        className="border-line bg-card text-foreground flex-1 rounded-md border px-2 py-1.5 text-xs"
                      />
                    </div>
                    {/* 시수(배수) — 정규 1회=1(빈 칸), 보강 연장 1.5·2, 부분 출석 0.5 */}
                    <label className="text-foreground flex items-center gap-2 text-xs">
                      <Clock className="text-text-dim size-3" />
                      시수
                      {/* 🔴 교시가 여럿이면 이 값은 그날 **합**이라 고칠 수 없다 — 되쓰면 각 교시에 합이
                          들어가 교시 수만큼 부풀려진다. 교시별 시수는 영어 수업 시트가 맡는다. */}
                      <input
                        type="text"
                        inputMode="decimal"
                        value={cell.units}
                        readOnly={r.slotCount > 1}
                        onChange={(e) => patchOne(r.studentId, { units: e.target.value })}
                        // 🔴 기록이 **없는** 학생은 빈 칸으로 저장하면 서버가 수학 자동 시수(수업 길이)를 넣는다
                        //    (auto-units.ts, 2026-09-11) — 빈 칸이 뜻하는 값을 그대로 보여 준다. 기록이 있으면 빈 칸 = 1.
                        placeholder={r.recordIds.length === 0 && autoUnits ? formatSessionUnits(autoUnits) : "1"}
                        title={
                          r.slotCount > 1
                            ? `${r.slotCount}개 교시의 합입니다 — 교시별 시수는 영어 수업 시트에서 고치세요`
                            : r.recordIds.length === 0 && autoUnits
                              ? `빈 칸으로 저장하면 이 수업 길이로 ${formatSessionUnits(autoUnits)}회분이 들어갑니다(출석·지각·조퇴·보강). 다른 값이면 직접 적으세요`
                              : "정규 수업 1회 = 1 (빈 칸). 보강 연장 1.5·2, 부분 출석 0.5 등"
                        }
                        className={`border-line bg-card text-foreground w-16 rounded-md border px-2 py-1.5 text-xs ${
                          r.slotCount > 1 ? "text-text-dim cursor-not-allowed" : ""
                        }`}
                      />
                      <span className="text-text-dim">
                        {r.slotCount > 1
                          ? `회분 (${r.slotCount}개 교시 합)`
                          : r.recordIds.length === 0 && autoUnits
                            ? `회분 (빈 칸 = ${formatSessionUnits(autoUnits)} · 수업 길이)`
                            : "회분 (빈 칸 = 1)"}
                      </span>
                    </label>
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="text-foreground inline-flex items-center gap-1.5 text-xs">
                        <input
                          type="checkbox"
                          checked={cell.homeworkRequired}
                          onChange={(e) =>
                            patchOne(r.studentId, { homeworkRequired: e.target.checked })
                          }
                        />
                        <BookOpen className="text-text-dim size-3" />
                        숙제 부여
                      </label>
                      <label
                        className={`inline-flex items-center gap-1.5 text-xs ${cell.homeworkRequired ? "text-foreground" : "text-text-dim opacity-50"}`}
                      >
                        <input
                          type="checkbox"
                          checked={cell.homeworkDone}
                          onChange={(e) =>
                            patchOne(r.studentId, { homeworkDone: e.target.checked })
                          }
                          disabled={!cell.homeworkRequired}
                        />
                        숙제 완료
                      </label>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {state?.error ? (
        <p className="text-danger bg-danger/10 border-danger/20 inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm">
          <AlertCircle className="size-4" />
          {state.error}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2 border-t pt-5">
        <span className="text-text-dim text-xs">
          {dirty ? "변경됨" : "변경 사항 없음"}
        </span>
        <SubmitButton />
      </div>
    </fieldset>
      {/* 보강 확인창 — key로 학생이 바뀔 때 상태를 새로 짓는다(effect 초기화 금지, #25). */}
      {makeupPick ? (
        <MakeupConfirmDialog
          key={makeupPick.id}
          studentName={makeupPick.name}
          // 이 화면은 그 반 한 칸을 여는 것이라 '합침' 선택지가 없다(합칠 정규 보고서를 모른다).
          candidates={[]}
          makeupDate={date}
          absences={absences}
          absenceLoading={absencesLoading}
          onConfirm={confirmMakeup}
          onCancel={() => setMakeupPick(null)}
        />
      ) : null}
    </form>
  );
}
