/**
 * **JJ실 기록 판정** — 순수 규칙(Vitest). 주는 규칙(어느 행을 누구 몫으로)은 [`seat-give.ts`](./seat-give.ts), 입구는 회차 확정의
 * JJ실 줄 하나다(원장 2026-10-07 *"회차 확정에 JJ반이 생기면 거기서 주면 그냥 쉽게 해결"* — 월별 출석부 칸의 넘기기 버튼은 걷었다).
 * 원장 2026-10-07:
 *   *"시험대비 같은 경우는 JJ실 수업을 담당이 대신 할 때가 있어서 … JJ(LAB) 시수를 넘겨줄 수 있는 방법도 있어야겠어"*
 *   → *"JJ 시수를 선생님에게 / 특정 JJ 시수를 넘길 수 있으면 됨. JJ가 -1되면, 다른 선생님이 +1 되도록. / 월별 출석부 우클릭으로 (권한 보유자 전용)"*.
 *
 * 자리(JJ실) 교시의 출결은 방 몫이라 어느 강사 출석부에도 안 선다(`teacher-axis.ts` `seat`). 그 기록 한 칸(학생 × 날짜)을
 * 한 선생님 몫으로 돌리는 표식은 이미 있다 — `attendance_records.taught_by`(0316a, 대신 보강 귀속). 넘기면 그 행은
 * 그 선생님 렌즈에서만 값이 되고(`ownsAttendanceSlot`이 `taughtBy`를 가장 먼저 본다) 출석부 실급여·정산도 그 사람 몫으로 읽는다.
 *
 * 🔴 **JJ실 기록만** — 랩실 기록(`seat_label`이 박힌 자리 시수, 0208a)은 대상이 아니다. 티어 정산이 그 행을 `seat_label`로 통째로 빼므로
 *    넘겨도 화면 시수와 정산 시수가 갈린다. 랩실까지 넘기려면 정산 쪽 규칙을 함께 바꿔야 한다(별건).
 * 🔴 자리 판정은 렌즈와 **같은 신호**다(`attendanceSlotShare`의 `seat` — 자리 문 표식 `recorded_via` · 그 교시가 자리 슬롯) —
 *    따로 지으면 화면이 "넘길 수 있다"고 한 칸을 저장이 거절한다.
 */
import { SELF_STUDY_ROOM_LABEL, specialSlotLabel } from "@/features/timetable/lib/teacher-label";
import type { AttendanceMark } from "./cell-display";
import { axisDowOf, isSeatSlot, normalizeAxisTime, slotLiveOn, type AxisSlot } from "./teacher-axis";

/** 자리 문(자리 출석부·공개 PIN)이 굳히는 값 — `attendance_records.recorded_via`(0212a). */
const SEAT_VIA = "seat";

export type SeatTransferRow = {
  slotStart: string | null;
  seatLabel: string | null;
  recordedVia: string | null;
  taughtBy: string | null;
  status: AttendanceMark;
  units: number | null;
};

/**
 * 이 기록이 **JJ실 자리 기록**인가(넘길 수 있는 시수).
 * · 랩실(`seat_label` 있음)은 아니다.
 * · 자리 문이 쓴 기록(`recorded_via = "seat"`)인데 라벨이 없으면 JJ실이다(랩실은 늘 라벨을 박는다).
 * · 그 밖에는 그 교시의 유효 슬롯이 **전부 JJ 자리 슬롯**일 때만(사람 슬롯이 하나라도 겹치면 사람 수업이다).
 */
export function isJjSeatRow(row: Pick<SeatTransferRow, "slotStart" | "seatLabel" | "recordedVia">, slots: readonly AxisSlot[], date: string): boolean {
  if (row.seatLabel?.trim()) return false;
  if (row.recordedVia === SEAT_VIA) return true;
  const start = normalizeAxisTime(row.slotStart);
  const dow = axisDowOf(date);
  if (!start || !dow) return false;
  const candidates = slots.filter((s) => s.dayOfWeek === dow && slotLiveOn(s, date) && normalizeAxisTime(s.startTime) === start);
  return candidates.length > 0 && candidates.every((s) => isSeatSlot(s) && specialSlotLabel(s.slotTeacherLabel) === SELF_STUDY_ROOM_LABEL);
}
