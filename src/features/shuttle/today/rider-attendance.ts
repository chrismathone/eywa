/**
 * 오늘 등하원 **하원 줄 아래 "출석함 · 누가 · 어디서"**(순수 · Vitest) — 사용자 2026-10-30
 * *"하원 차에 타는 아이들이 출석이 찍히면 이름·학교 카드 밑에 출석함, 어디 선생님이 어디에서 수업 중인지"*.
 *
 * 🔑 **읽기만 한다** — 셔틀 기록이 출석에 영향을 주지 않는다(사용자 2026-10-30 "등원이 출석에 영향을 주는 경우는 없게").
 * 🔑 판정 = 출석부와 같은 규칙: 같은 학생·반·날짜·교시 중 **최신 정정 한 줄**(`effectiveAttendanceRecords`)이
 *    출석·지각(`isAttendedStatus`)일 때만 "출석함". 결석·조퇴 등은 띄우지 않는다.
 * 🔑 '누가' = **찍은 사람**(사용자 *"찍은 사람이랑 수업은 같을 거야 — 분리해서 생각하긴 어렵다"*). 사람이 없는 기록
 *    (키오스크·자리 PIN)은 그 방법을 적는다.
 * 🔑 '어디서' = 그 교시의 강의실. 교시를 못 정하면(같은 날 그 반 교시가 여럿인데 기록에 교시가 없음) 시각·강의실을 비운다(지어내지 않는다).
 */
import { effectiveAttendanceRecords } from "@/features/attendance/effective-records";
import { isAttendedStatus } from "@/lib/calc/attendance";

export type AttendanceRow = {
  id: string;
  student_id: string;
  class_id: string;
  session_date: string;
  slot_start: string | null;
  status: string;
  recorded_by: string | null;
  recorded_via: string | null;
  seat_label: string | null;
  access_method: string | null;
  recorded_at: string;
};
export type ScheduleRow = { class_id: string; start_time: string; end_time: string; room: string | null };

export type RiderAttendance = {
  late: boolean;
  /** 찍은 사람 — 직원 이름, 없으면 방법("키오스크"·"LAB실 PIN"). */
  by: string;
  /** 사람이 찍었나(이름 뒤에 '선생님'을 붙일지). */
  byPerson: boolean;
  className: string;
  /** "16:00~17:50" — 교시를 못 정하면 null. */
  time: string | null;
  room: string | null;
};

const hm = (t: string) => t.slice(0, 5);

function viaLabel(r: AttendanceRow): string {
  if (r.recorded_via === "kiosk" || r.access_method === "kiosk") return "키오스크";
  if (r.recorded_via === "seat") return r.seat_label ? `${r.seat_label} PIN` : "자리 출석부";
  return "출석부";
}

export function buildRiderAttendance(
  records: readonly AttendanceRow[],
  classNameOf: ReadonlyMap<string, string>,
  userNameOf: ReadonlyMap<string, string>,
  /** 그날(요일·유효 기간) 그 반 교시들. */
  schedulesOf: ReadonlyMap<string, readonly ScheduleRow[]>,
): Record<string, RiderAttendance[]> {
  const out: Record<string, RiderAttendance[]> = {};
  for (const r of effectiveAttendanceRecords(records)) {
    if (!isAttendedStatus(r.status)) continue;
    const slots = schedulesOf.get(r.class_id) ?? [];
    const slot = r.slot_start ? slots.find((s) => hm(s.start_time) === hm(r.slot_start!)) : slots.length === 1 ? slots[0] : undefined;
    const person = r.recorded_by ? userNameOf.get(r.recorded_by) : undefined;
    (out[r.student_id] ??= []).push({
      late: r.status === "late",
      by: person ?? viaLabel(r),
      byPerson: !!person,
      className: classNameOf.get(r.class_id) ?? "반 정보 없음",
      time: slot ? `${hm(slot.start_time)}~${hm(slot.end_time)}` : r.slot_start ? hm(r.slot_start) : null,
      room: slot?.room ?? null,
    });
  }
  for (const list of Object.values(out)) list.sort((a, b) => (a.time ?? "99").localeCompare(b.time ?? "99"));
  return out;
}

/** 한 줄 문구 — "출석함 · 박소선 선생님 · 중등 수학 A반 16:00~17:50 · 본원302". */
export function riderAttendanceText(a: RiderAttendance): string {
  return [
    a.late ? "출석함(지각)" : "출석함",
    a.byPerson ? `${a.by} 선생님` : a.by,
    [a.className, a.time].filter(Boolean).join(" "),
    a.room,
  ]
    .filter(Boolean)
    .join(" · ");
}
