/** 연결 예약의 시수는 옛 이행과 같은 절대값으로 한 번만 쓴다. 참여 명령은 출결 행을 고치지 않는다. */

import { unitsFromMinutes } from "@/features/attendance/auto-units";
import { round1 } from "@/features/attendance/session-units";

export type MappedUnitWrite = {
  /** undefined = 쓰지 않음. null = 저장 규약의 1. */
  writeUnits: number | null | undefined;
  expectedUnits: number | null;
  /** 정규 수업이 있는 날의 출석은 보강 실시 증거가 아니다. */
  regularDay: boolean;
  withheld: boolean;
  manual: boolean;
};

/**
 * 수기(unitsExplicit)가 우선이다. 새 칸이거나 시수가 아직 비었고 하루 칸일 때만 쓴다.
 * 정규 수강생이면 수업 길이 시수 + 보강 시수, 아니면 보강 시수만. 수업 길이를 모르면 쓰지 않는다.
 * 반복 호출은 현재값에 더하지 않고 같은 절대값을 낸다.
 */
export function planMappedAttendanceUnits(input: {
  unitsExplicit: boolean;
  created: boolean;
  storedUnits: number | null;
  makeupUnits: number | null;
  dayWide: boolean;
  regularAttendee: boolean;
  classMinutes: number | null;
}): MappedUnitWrite {
  const manual = input.unitsExplicit;
  const regularDay = input.regularAttendee && input.classMinutes !== null && input.classMinutes > 0;
  let base: number | null = 0;
  let withheld = false;
  if (input.regularAttendee) {
    if (input.classMinutes === null) {
      base = null;
      withheld = true;
    } else if (input.classMinutes > 0) base = unitsFromMinutes(input.classMinutes) ?? 1;
    else base = 0;
  }
  const expected = !withheld && base !== null && input.makeupUnits !== null ? round1(base + input.makeupUnits) : null;
  const untouched = input.created || input.storedUnits === null;
  const write = !manual && untouched && input.dayWide && expected !== null;
  return {
    writeUnits: write ? (expected === 1 ? null : expected) : undefined,
    expectedUnits: expected,
    regularDay, withheld, manual,
  };
}

export function participationStatusOf(mark: string): "present" | "partial" | "no_show" | null {
  if (mark === "present" || mark === "late" || mark === "makeup") return "present";
  if (mark === "early_leave") return "partial";
  if (mark === "absent" || mark === "excused") return "no_show";
  return null;
}

export type ParticipationSend =
  | { send: false; reason: "regular_day" | "unknown_mark" | "unknown_actual" }
  | { send: true; status: "present" | "no_show"; actualMinutes: number | null };

/** 정규일 출석·분량을 모르는 출석은 참여로 보내지 않는다. 노쇼의 실제 분은 0이다. */
export function mappedParticipationSend(input: {
  regularDay: boolean;
  mark: string | null;
  slotMinutes: number;
}): ParticipationSend {
  if (input.regularDay) return { send: false, reason: "regular_day" };
  const status = input.mark ? participationStatusOf(input.mark) : null;
  if (!status) return { send: false, reason: "unknown_mark" };
  if (status === "partial") return { send: false, reason: "unknown_actual" };
  if (status === "no_show") return { send: true, status, actualMinutes: 0 };
  if (!Number.isInteger(input.slotMinutes) || input.slotMinutes < 1 || input.slotMinutes > 600) {
    return { send: false, reason: "unknown_actual" };
  }
  return { send: true, status: "present", actualMinutes: input.slotMinutes };
}

/** 참여 명령이 보내는 키. SQL cmd_participation 이 읽는 키와 같다. report_id 는 있을 때만. */
export function participationCommandPayload(input: {
  participantId: string;
  studentId: string;
  subjectKey: string;
  sessionDate: string;
  classId: string;
  status: "present" | "no_show";
  attendanceRecordId: string | null;
  effectKey: string;
  actualMinutes: number | null;
  manualUnits: number | null;
  expectedMakeupUnits: number | null;
  expectedTotalUnits: number | null;
  reportId: string | null;
}): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    participant_id: input.participantId, student_id: input.studentId, subject_key: input.subjectKey,
    session_date: input.sessionDate, class_id: input.classId, status: input.status,
    attendance_record_id: input.attendanceRecordId, effect_key: input.effectKey,
    actual_minutes: input.actualMinutes, manual_units: input.manualUnits,
    expected_makeup_units: input.expectedMakeupUnits, expected_total_units: input.expectedTotalUnits,
  };
  if (input.reportId) payload.report_id = input.reportId;
  return payload;
}

const HANDS_OFF = new Set(["reserve", "verify", "legacy_done", "participation"]);

/** 예약·검증·옛 완료·참여 명령 자체는 정규 출결 행을 고치지 않는다. 시수 쓰기는 어댑터의 한 번 기록이다. */
export function effectMayTouchAttendance(kind: "reserve" | "verify" | "legacy_done" | "participation"): boolean {
  return !HANDS_OFF.has(kind);
}
