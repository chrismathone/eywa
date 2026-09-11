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
import { useRef, useState } from "react";
import { toast } from "sonner";
import { setAttendanceCell } from "../server/actions";
import { noteMakeupAgainstAbsence } from "../server/makeup-note-action";
import { fetchMakeupAbsences } from "../server/makeup-actions";
import type { MakeupAbsenceList } from "../makeup-options";
import type { MakeupSlotOption } from "../makeup-slot";
import { MakeupConfirmDialog, type MakeupConfirmChoice } from "./makeup-confirm-dialog";
import {
  AttendanceMakeupAdder,
  type MakeupPick,
} from "@/app/(shell)/attendance/[date]/[classId]/makeup-adder";

/** 아직 안 불러왔을 때의 빈 한 벌. */
const EMPTY_ABSENCES: MakeupAbsenceList = { options: [], hiddenBySubject: 0 };

export function MakeupAddFlow({
  classId,
  date,
  disabled,
  alreadyIn,
  slotOptions,
  onDone,
}: {
  classId: string;
  /** 보강을 하는 날(YYYY-MM-DD). */
  date: string;
  disabled?: boolean;
  /** 이미 그 반 명단에 있는 학생 id — 중복 추가를 막고 이유를 알린다. */
  alreadyIn?: ReadonlySet<string>;
  /**
   * 그 반 그날의 교시 — **교시 축 화면(ECS)만** 넘긴다. 넘기면 확인창이 교시를 묻고 그 교시 칸에
   * 저장한다. 안 넘기면 종전대로 "그날 전체"로 저장한다(원스크린·반별 출석부의 축).
   */
  slotOptions?: readonly MakeupSlotOption[];
  onDone?: () => void;
}) {
  const [pending, setPending] = useState<MakeupPick | null>(null);
  const [absences, setAbsences] = useState<MakeupAbsenceList>(EMPTY_ABSENCES);
  const [loading, setLoading] = useState(false);
  /** 결석 조회 응답 순서 가드. */
  const seq = useRef(0);

  function pickStudent(s: MakeupPick) {
    if (alreadyIn?.has(s.id)) {
      toast.message(`${s.name}은(는) 이미 이 반 명단에 있습니다`);
      return;
    }
    setPending(s);
    setAbsences(EMPTY_ABSENCES);
    setLoading(true);
    // 🔴 늦게 온 옛 조회가 최신 창을 덮지 않게 — 안 그러면 **남의 결석 이력**이 이 학생 것처럼 뜬다.
    const mine = ++seq.current;
    // 창은 먼저 열고 목록만 도착하면 갈아 끼운다 — 조회를 기다리며 멈춰 있으면 "눌러도 반응 없다"가 된다.
    // 🔴 후보는 **이 반의 과목**으로 좁힌다(영어 반 보강에 수학 결석이 뜨지 않게) — 과목 판정은
    //    서버가 이 반 id로 한다.
    void fetchMakeupAbsences(s.id, date, classId)
      .then((list) => {
        if (mine !== seq.current) return;
        setAbsences(list);
      })
      .catch(() => {
        if (mine !== seq.current) return;
        setAbsences(EMPTY_ABSENCES);
      })
      .finally(() => {
        if (mine !== seq.current) return;
        setLoading(false);
      });
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
      // 🔴 확인창이 **보여 준 숫자 그대로**(1 포함) 보낸다 — 안 보내면 '기본'이라 수학 반에선 서버가 수업 길이
      //    자동 시수(auto-units.ts, 2026-09-11)를 넣어 "수업타임 1" 안내와 기록이 갈린다. "1"은 null로 저장된다.
      units: String(choice.addUnits),
      // 교시를 골랐으면 **그 교시 칸**에 쓴다 — 안 넘기면 "그날 전체" 행이 되어 주간 시트가 그것을
      // 첫 교시에 붙인다(영어는 하루 한 교시인 반이 없어 늘 어긋난다).
      ...(choice.slotStart ? { slotStart: choice.slotStart } : {}),
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
    // 🔴 시수는 위에서 이미 그 칸에 적었다 — 여기선 **메모만** 잇는다(합산 액션을 쓰면 두 번 더해진다).
    const res = await noteMakeupAgainstAbsence({
      studentId: s.id,
      makeupClassId: classId,
      makeupDate: date,
      absentClassId: choice.absentClassId ?? classId,
      absentDate: choice.absentDate,
    });
    if ("error" in res) {
      // 칸은 이미 열렸다 — 연결만 실패했다는 사실을 그대로 알린다(둘 다 실패한 것처럼 말하지 않는다).
      toast.error(`보강은 추가됐지만 결석분 연결에 실패했습니다 — ${res.error}`);
      onDone?.();
      return;
    }
    toast.success(
      res.absenceNoted
        ? `${s.name} 보강 추가 — 결석 칸에 메모, 수업타임 ${choice.addUnits}`
        : `${s.name} 보강 추가 — 수업타임 ${choice.addUnits}. 그날 결석 기록이 없어 메모는 남기지 않았습니다.`,
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
          absences={absences}
          absenceLoading={loading}
          slotOptions={slotOptions}
          onConfirm={(c) => void confirm(c)}
          onCancel={() => setPending(null)}
        />
      ) : null}
    </>
  );
}
