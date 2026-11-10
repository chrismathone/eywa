import "server-only";
import { attendanceWindowApplies } from "@/features/attendance/server/edit-window-gate";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged, fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { accessLevelTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getTeachingClassIds } from "@/features/classes/server/delegation";
import { kstToday } from "@/lib/date-kst";
import { getClassNameAsOfIndex } from "@/features/classes/server/class-name-as-of-queries";
import { resolveClassNameAsOf } from "@/features/classes/class-name-as-of";
import { settingsToPeriodsConfig, weekdayTableFor } from "@/features/timetable/lib/periods";
import { getTenantSettings } from "@/features/owner/server/queries";
import { isWithinAttendanceEditWindow } from "@/features/attendance/edit-window";
import type { SpecialSlotLabel } from "@/features/timetable/lib/teacher-label";
import { tableToEntries } from "../lib/period-label";
import { isWeekendDow } from "../lib/grid-rows";
import { dowKeyOf, YMD_RE } from "../lib/week";
import { readEcsFontSize } from "../font-size";
import { isSeatLabel, type SeatSlotRef } from "../lib/seat-day";
import { ecsVisibleClassFilter } from "./access";
import { loadViewerUiPrefs } from "./viewer-prefs";
import { assembleSeatPeriods, type SeatAttRow, type SeatEnr, type SeatMarkRow } from "./seat-day-assemble";
import type { SeatDayData, SeatDayResult } from "./seat-day-types";

export type { SeatDayData, SeatDayPeriod, SeatDayResult, SeatDayStudent } from "./seat-day-types";

/**
 * 자리(JJ/LAB) **하루**. 스코프 있으면 그 반만, 없으면(사무실) 전 영어 반.
 * 저장은 기존 `setAttendanceCell` / `upsertStudentMark` — 여기선 조회만.
 */
export async function getEcsSeatDay(
  seat: SpecialSlotLabel,
  dateRaw: string | null,
): Promise<SeatDayResult> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  const ecsLevel = await accessLevelTenant(user.systemRole, "ecs");
  if (ecsLevel === "none") return { ok: false, error: "접근 권한이 없습니다" };

  const today = kstToday();
  const date = dateRaw && YMD_RE.test(dateRaw) ? dateRaw : today;
  const dow = dowKeyOf(date);
  const supabase = await createClient();
  const [{ classIds: visibleIds }, settings, prefsRes, sched, nameIndex] = await Promise.all([
    ecsVisibleClassFilter(),
    getTenantSettings(),
    // 글씨 크기는 보는 사람(실제 계정) 것 — 쓰기(setMyEcsFontSize → patchMyUiPrefs)와 같은 행(viewer-prefs.ts).
    loadViewerUiPrefs(),
    fetchAllPaged<{
      class_id: string;
      start_time: string;
      end_time: string | null;
      slot_teacher_label: string | null;
    }>((from, to) =>
      supabase
        .from("class_schedules")
        .select("class_id, start_time, end_time, slot_teacher_label")
        .eq("day_of_week", dow)
        .lte("valid_from", date)
        .or(`valid_to.is.null,valid_to.gte.${date}`)
        .order("id")
        .range(from, to),
    ),
    // 🔴 자리판은 **날짜 단위**라 그 날짜의 이름으로 부른다(예약된 개명 반영, 원장 2026-08-29).
    //    여기 className은 표시 전용(`shortClassLabel`·title)이라 키로 새지 않는다.
    //    위 넷과 독립이라 같은 묶음(B4) — 요청 캐시라 같은 요청의 '오늘' 뷰가 또 물어도 왕복 0.
    getClassNameAsOfIndex(),
  ]);

  const seatSched = sched.filter((s) => isSeatLabel(s.slot_teacher_label, seat));
  const rawClassIds = [...new Set(seatSched.map((s) => s.class_id))];
  const classRows = await fetchInChunks<{
    id: string;
    class_name: string;
    subject: string;
    is_active: boolean;
    closed_at: string | null;
  }>(rawClassIds, (chunk) =>
    supabase.from("classes").select("id, class_name, subject, is_active, closed_at").in("id", chunk),
  );
  const classById = new Map(classRows.map((c) => [c.id, c]));
  const scopeSet = visibleIds ? new Set(visibleIds) : null;

  const slots: SeatSlotRef[] = [];
  for (const s of seatSched) {
    if (scopeSet && !scopeSet.has(s.class_id)) continue;
    const cls = classById.get(s.class_id);
    if (!cls || cls.subject !== "english" || !cls.is_active) continue;
    if (cls.closed_at && cls.closed_at < date) continue;
    slots.push({
      classId: s.class_id,
      className: resolveClassNameAsOf(nameIndex, s.class_id, date, cls.class_name)?.name ?? cls.class_name,
      startTime: s.start_time,
      endTime: s.end_time,
      slotTeacherLabel: s.slot_teacher_label,
    });
  }

  const classIds = [...new Set(slots.map((s) => s.classId))];
  const empty: SeatDayData = {
    date,
    today,
    seat,
    periods: [],
    userId: user.id,
    tenantId: user.tenantId,
    canWriteEcs: ecsLevel === "full" || ecsLevel === "scoped",
    fontSize: readEcsFontSize(prefsRes.data?.ui_prefs),
  };
  if (classIds.length === 0) return { ok: true, data: empty };

  const admin = createAdminClient();
  const [enrollments, marksRaw, attendanceRaw] = await Promise.all([
    fetchAllPagedInChunks<SeatEnr>(classIds, (chunk, from, to) =>
      supabase
        .from("enrollments")
        .select(
          "class_id, student_id, attendance_days, start_date, end_date, on_hold, is_transferred, students!inner(withdrawn_at)",
        )
        .in("class_id", chunk)
        .lte("start_date", date)
        .order("id")
        .range(from, to),
    ),
    fetchAllPagedInChunks<SeatMarkRow>(classIds, (chunk, from, to) =>
      admin
        .from("class_sheet_student_marks")
        .select("*")
        .eq("tenant_id", user.tenantId)
        .in("class_id", chunk)
        .eq("mark_date", date)
        .order("id")
        .range(from, to),
    ),
    fetchAllPagedInChunks<SeatAttRow>(classIds, (chunk, from, to) =>
      supabase
        .from("attendance_records")
        .select("id, class_id, student_id, status, note, recorded_at, session_date, slot_start, session_units")
        .in("class_id", chunk)
        .eq("session_date", date)
        .order("id")
        .range(from, to),
    ),
  ]);

  const studentIds = [
    ...new Set([
      ...enrollments.map((e) => e.student_id),
      ...marksRaw.map((m) => m.student_id),
      ...attendanceRaw.map((a) => a.student_id),
    ]),
  ];
  const studentRows = await fetchInChunks(studentIds, (chunk) =>
    supabase.from("students").select("id, name, school, grade, english_name").in("id", chunk),
  );

  const attendanceWritable =
    (await canWriteTenant(user.systemRole, "attendance")) &&
    (!(await attendanceWindowApplies(user.systemRole)) || isWithinAttendanceEditWindow(date, today));
  // ↑ 7일 창 = 출석 권한 단계(서버 액션과 같은 판정 — 화면과 서버가 갈리면 켜진 단추가 거절된다, 4-5 리뷰).
  const attendanceScoped = (await accessLevelTenant(user.systemRole, "attendance")) === "scoped";
  const teachingSet =
    attendanceWritable && attendanceScoped
      ? new Set((await getTeachingClassIds(supabase, user.id, date)).all)
      : null;

  const periodsConfig = settingsToPeriodsConfig(settings.operations);
  return {
    ok: true,
    data: {
      ...empty,
      periods: assembleSeatPeriods({
        date,
        dow,
        slots,
        enrollments,
        marksRaw,
        attendanceRaw,
        studentRows,
        canWriteEcs: empty.canWriteEcs,
        attendanceWritable,
        teachingSet,
        periodTables: {
          weekday: tableToEntries(weekdayTableFor("english", periodsConfig)),
          weekend: tableToEntries(periodsConfig.weekend),
        },
        weekend: isWeekendDow(dow),
      }),
    },
  };
}
