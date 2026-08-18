"use client";

/**
 * 보강 추가 **흐름** — 검색 → 확인창(결석분·시수) → 저장. 원장 2026-08-19: *"영어도 보강추가시 같은
 * 동작으로 하게 해주고."* 원스크린과 ECS가 같은 질문을 하도록 이 컴포넌트가 한 벌을 갖는다.
 *
 * 저장은 두 걸음이고 **순서가 있다**:
 *  ① `setAttendanceCell(status:"makeup", units)` — 그 반 그 날 칸을 연다(세 화면이 같은 칸을 본다).
 *  ② 결석분을 골랐으면 `linkMakeupToAbsence` — **메모는 결석이 난 반**(이월 보강이면 옛 반), **시수는
 *     오늘 보강한 반**. ①을 먼저 해야 ②가 그 칸을 찾아 갱신한다(없으면 ②가 '출석'으로 새로 열어 버린다).
 */
import { useState } from "react";
import { toast } from "sonner";
import { linkMakeupToAbsence, setAttendanceCell } from "../server/actions";
import { fetchMakeupAbsences } from "../server/makeup-actions";
import type { MakeupAbsenceOption } from "../makeup-options";
import { MakeupConfirmDialog, type MakeupConfirmChoice } from "./makeup-confirm-dialog";
import {
  AttendanceMakeupAdder,
  type MakeupPick,
} from "@/app/(shell)/attendance/[date]/[classId]/makeup-adder";

export function MakeupAddFlow({
  classId,
  date,
  disabled,
  alreadyIn,
  onDone,
}: {
  classId: string;
  /** 보강을 하는 날(YYYY-MM-DD). */
  date: string;
  disabled?: boolean;
  /** 이미 그 반 명단에 있는 학생 id — 중복 추가를 막고 이유를 알린다. */
  alreadyIn?: ReadonlySet<string>;
  onDone?: () => void;
}) {
  const [pending, setPending] = useState<MakeupPick | null>(null);
  const [absences, setAbsences] = useState<MakeupAbsenceOption[]>([]);
  const [loading, setLoading] = useState(false);

  function pickStudent(s: MakeupPick) {
    if (alreadyIn?.has(s.id)) {
      toast.message(`${s.name}은(는) 이미 이 반 명단에 있습니다`);
      return;
    }
    setPending(s);
    setAbsences([]);
    setLoading(true);
    // 창은 먼저 열고 목록만 도착하면 갈아 끼운다 — 조회를 기다리며 멈춰 있으면 "눌러도 반응 없다"가 된다.
    void fetchMakeupAbsences(s.id, date)
      .then((list) => setAbsences(list))
      .catch(() => setAbsences([]))
      .finally(() => setLoading(false));
  }

  async function confirm(choice: MakeupConfirmChoice) {
    const s = pending;
    setPending(null);
    if (!s) return;
    const cell = await setAttendanceCell({
      classId,
      studentId: s.id,
      sessionDate: date,
      status: "makeup",
      allowMakeup: true,
      ...(choice.addUnits !== 1 ? { units: String(choice.addUnits) } : {}),
    });
    if ("error" in cell) {
      toast.error(cell.error);
      return;
    }
    if (!choice.absentDate) {
      toast.success(`${s.name} 보강 추가 — 수업타임 ${choice.addUnits}`);
      onDone?.();
      return;
    }
    const res = await linkMakeupToAbsence({
      studentId: s.id,
      classId,
      absentDate: choice.absentDate,
      absentClassId: choice.absentClassId,
      makeupDate: date,
      addUnits: choice.addUnits,
    });
    if ("error" in res) {
      // 칸은 이미 열렸다 — 연결만 실패했다는 사실을 그대로 알린다(둘 다 실패한 것처럼 말하지 않는다).
      toast.error(`보강은 추가됐지만 결석분 연결에 실패했습니다 — ${res.error}`);
      onDone?.();
      return;
    }
    toast.success(
      res.absenceNoted
        ? `${s.name} 보강 추가 — 결석 칸에 메모, 수업타임 ${res.units}`
        : `${s.name} 보강 추가 — 수업타임 ${res.units}. 그날 출결 기록이 없어 메모는 남기지 않았습니다.`,
    );
    onDone?.();
  }

  return (
    <>
      <AttendanceMakeupAdder classId={classId} date={date} disabled={disabled} onAdd={pickStudent} />
      {pending ? (
        <MakeupConfirmDialog
          key={pending.id}
          studentName={pending.name}
          // ECS·출석부는 그 반 한 칸을 여는 것이라 '합침' 선택지가 없다(합칠 정규 보고서를 모른다).
          candidates={[]}
          makeupDate={date}
          absenceOptions={absences}
          absenceLoading={loading}
          onConfirm={(c) => void confirm(c)}
          onCancel={() => setPending(null)}
        />
      ) : null}
    </>
  );
}
