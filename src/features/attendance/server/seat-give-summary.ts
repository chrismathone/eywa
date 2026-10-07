import "server-only";
import { monthRange } from "@/lib/date-kst";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { createClient } from "@/lib/supabase/server";
import { SELF_STUDY_ROOM_LABEL, specialSlotLabel } from "@/features/timetable/lib/teacher-label";
import { consumedUnits, type AttendanceMark } from "../cell-display";
import { isJjSeatRow } from "../seat-transfer";
import { axisSlotFromRow, isSeatSlot, type AxisSlot } from "../teacher-axis";
import { attendanceSalaryAdminOrNull } from "./salary-rates";
import { taughtByColumnReady } from "./taught-by-db";

/**
 * 회차 확정의 **JJ실 줄** 재료(원장 2026-10-07 *"회차 확정에 JJ반이 생기면 거기서 주면"*) — 그 달 JJ실 교시가 있는 반과,
 * 반마다 이미 선생님에게 준 시수. 줄을 세울지와 한 줄 요약만 정한다 — 날짜별 표는 창을 열 때 읽는다(`loadSeatGiveSheet`).
 *
 * 🔴 권한이 없으면 null — 줄 자체를 세우지 않는다(급여 비율을 고칠 수 있는 사람만 · 급여 기능이 꺼진 지점 · '다른 강사 뷰' 제외).
 * 🔑 준 시수는 실급여 상한 이동(`loadTakenSeatRows`)과 **같은 재료**로 센다 — 귀속이 찍힌 JJ실 기록, 교시마다 최신 한 행.
 * ⚠️ 조회 실패는 null로 접는다 — 회차 확정 표는 그대로 열리고 JJ실 줄만 안 선다(사무실이 매일 쓰는 표라 이 조회 하나로 죽지 않게).
 */
export type SeatGiveSummary = {
  /** 그 달 JJ실 교시가 있는 반. */
  classIds: string[];
  /** 반 id → 이미 준 시수(선생님마다). */
  given: Record<string, { teacherId: string; name: string; units: number }[]>;
};

type ScheduleRow = {
  class_id: string; day_of_week: string; start_time: string | null; teacher_id: string | null;
  slot_teacher_label: string | null; valid_from: string; valid_to: string | null;
};
type GivenRow = {
  id: string; class_id: string; student_id: string; session_date: string; slot_start: string | null; seat_label: string | null;
  recorded_via: string | null; taught_by: string; status: string; session_units: number | string | null; recorded_at: string | null;
};

export async function loadSeatGiveSummary(period: string): Promise<SeatGiveSummary | null> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return null;
  try {
    // 🔴 이동 없는 문으로 본다 — 출석부 메뉴가 닫힌 수납 계정이 회차 확정을 열어도 화면이 튕기지 않는다(줄만 안 선다).
    const user = await attendanceSalaryAdminOrNull();
    if (!user) return null;
    const { from, to } = monthRange(period);
    const supabase = await createClient();
    const admin = createAdminClient();
    const withTaughtBy = await taughtByColumnReady(admin).catch(() => false);
    const [schedules, givenRows] = await Promise.all([
      // 그 달과 겹치는 교시 전부(지점 전체 — 세션 클라이언트의 RLS가 지점을 가른다). 이력을 담는 표라 페이지로 읽는다([[#88]]).
      fetchAllPaged<ScheduleRow>((f, t) => supabase.from("class_schedules")
        .select("class_id, day_of_week, start_time, teacher_id, slot_teacher_label, valid_from, valid_to")
        .lte("valid_from", to).or(`valid_to.is.null,valid_to.gte.${from}`)
        .order("id", { ascending: true }).range(f, t)),
      withTaughtBy
        ? fetchAllPaged<GivenRow>((f, t) => admin.from("attendance_records")
            .select("id, class_id, student_id, session_date, slot_start, seat_label, recorded_via, taught_by, status, session_units, recorded_at")
            .eq("tenant_id", user.tenantId).not("taught_by", "is", null).gte("session_date", from).lte("session_date", to)
            .order("id", { ascending: true }).range(f, t))
        : Promise.resolve([] as GivenRow[]),
    ]);
    const slotsByClass = new Map<string, AxisSlot[]>();
    const classIds = new Set<string>();
    for (const s of schedules) {
      const slot = axisSlotFromRow({
        day_of_week: String(s.day_of_week), start_time: s.start_time ?? null, teacher_id: s.teacher_id, slot_teacher_label: s.slot_teacher_label ?? null,
        valid_from: String(s.valid_from), valid_to: s.valid_to ?? null,
      });
      const list = slotsByClass.get(s.class_id);
      if (list) list.push(slot);
      else slotsByClass.set(s.class_id, [slot]);
      if (isSeatSlot(slot) && specialSlotLabel(slot.slotTeacherLabel) === SELF_STUDY_ROOM_LABEL) classIds.add(s.class_id);
    }
    // 준 시수 — 교시마다 최신 한 행, JJ실 기록만(대신 보강 귀속이 걸린 사람 수업 행은 세지 않는다).
    const latest = new Map<string, GivenRow>();
    for (const r of [...givenRows].sort((a, b) => (b.recorded_at ?? "").localeCompare(a.recorded_at ?? "") || b.id.localeCompare(a.id))) {
      const key = `${r.class_id}|${r.student_id}|${r.session_date}|${r.slot_start ?? ""}`;
      if (!latest.has(key)) latest.set(key, r);
    }
    const units = new Map<string, Map<string, number>>();
    for (const r of latest.values()) {
      if (!isJjSeatRow({ slotStart: r.slot_start, seatLabel: r.seat_label, recordedVia: r.recorded_via }, slotsByClass.get(r.class_id) ?? [], r.session_date)) continue;
      const raw = r.session_units === null || r.session_units === undefined ? null : Number(r.session_units);
      const u = consumedUnits(r.status as AttendanceMark, raw !== null && Number.isFinite(raw) ? raw : null);
      if (!(u > 0)) continue;
      const byTeacher = units.get(r.class_id) ?? new Map<string, number>();
      byTeacher.set(r.taught_by, (byTeacher.get(r.taught_by) ?? 0) + u);
      units.set(r.class_id, byTeacher);
      // 교시표에서 JJ 슬롯이 빠진 뒤에도 준 기록이 남아 있으면 줄을 세운다(되돌릴 수 있어야 한다).
      classIds.add(r.class_id);
    }
    const teacherIds = [...new Set([...units.values()].flatMap((m) => [...m.keys()]))];
    const users = await fetchInChunks<{ id: string; display_name: string | null }>(teacherIds, (chunk) =>
      supabase.from("users").select("id, display_name").in("id", chunk));
    const nameOf = new Map(users.map((u) => [u.id, u.display_name ?? "선생님"]));
    const given: SeatGiveSummary["given"] = {};
    for (const [classId, byTeacher] of units) {
      given[classId] = [...byTeacher].map(([teacherId, u]) => ({ teacherId, name: nameOf.get(teacherId) ?? "선생님", units: Math.round(u * 10) / 10 }))
        .sort((a, b) => a.name.localeCompare(b.name, "ko"));
    }
    return { classIds: [...classIds], given };
  } catch (error) {
    console.error("[seat-give-summary] JJ실 줄 재료 조회 실패 — 줄을 세우지 않는다:", error instanceof Error ? error.message : error);
    return null;
  }
}
