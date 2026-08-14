import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged, fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { addDays, kstToday } from "@/lib/date-kst";
import { effectiveAttendanceRecords } from "@/features/attendance/effective-records";
import { buildHolidayMap } from "@/features/attendance/calendar";
import { getPeriodWindow } from "@/features/periods/server/queries";
import { monthBounds } from "@/features/periods/resolve";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildPeriodMatcher } from "@/features/timetable/lib/period-match";
import {
  periodSoloLabel,
  settingsToPeriodsConfig,
  subjectWeekdayPeriods,
} from "@/features/timetable/lib/periods";
import { specialSlotLabel } from "@/features/timetable/lib/teacher-label";
import { hhmm, SEAT_DB_LABEL, type SeatKey } from "../seat";
import { buildMonthDays, isSlotLiveOnDate, padDaysTo31, type SeatAttRecord, type SeatSlotDef } from "../monthly";
import { buildSeatMonthly, type SeatEnrollRow, type SeatMonthlyView } from "../monthly-build";

/**
 * 자리 월간 — 슬롯·반·수강·기록을 **각 1회** 읽고 반별로 조립(N+1 금지).
 * 기간 축은 getPeriodWindow(세션 우선, 과목이 섞이면 달력월).
 */
export async function getSeatMonthly(seat: SeatKey, month: string): Promise<SeatMonthlyView> {
  const supabase = await createClient();
  const today = kstToday();
  const bounds = monthBounds(month);
  const qStart = bounds ? addDays(bounds.start, -45) : `${month}-01`;
  const qEnd = bounds ? addDays(bounds.end, 45) : `${month}-31`;
  const want = SEAT_DB_LABEL[seat];

  const [rawSlots, settings] = await Promise.all([
    fetchAllPaged<{
      id: string;
      class_id: string;
      day_of_week: string;
      start_time: string;
      end_time: string;
      slot_teacher_label: string | null;
      valid_from: string;
      valid_to: string | null;
    }>((from, to) =>
      supabase
        .from("class_schedules")
        .select("id, class_id, day_of_week, start_time, end_time, slot_teacher_label, valid_from, valid_to")
        .not("slot_teacher_label", "is", null)
        .lte("valid_from", qEnd)
        .or(`valid_to.is.null,valid_to.gte.${qStart}`)
        .order("class_id")
        .order("id")
        .range(from, to),
    ),
    getTenantSettings(),
  ]);

  const seatRows = rawSlots.filter((r) => specialSlotLabel(r.slot_teacher_label) === want);
  const classIds = [...new Set(seatRows.map((r) => r.class_id))];
  const classes = classIds.length
    ? await fetchInChunks<{ id: string; class_name: string; subject: string }>(classIds, (chunk) =>
        supabase.from("classes").select("id, class_name, subject").in("id", chunk),
      )
    : [];

  const subjects = [...new Set(classes.map((c) => c.subject).filter(Boolean))];
  const periodWindow = await getPeriodWindow({
    period: month,
    subjectKey: subjects.length === 1 ? subjects[0] : null,
    mode: subjects.length === 1 ? "session" : "month",
    todayIso: today,
  });
  const days = padDaysTo31(buildMonthDays(periodWindow.start, periodWindow.end, today));
  const slots: SeatSlotDef[] = seatRows
    .map((r) => ({
      classId: r.class_id,
      dayOfWeek: r.day_of_week,
      start: hhmm(r.start_time),
      end: hhmm(r.end_time),
      validFrom: r.valid_from,
      validTo: r.valid_to,
    }))
    .filter((s) => days.some((d) => !d.placeholder && isSlotLiveOnDate(s, d.date)));

  const liveClassIds = [...new Set(slots.map((s) => s.classId))];
  const [enrollments, records] = await Promise.all([
    fetchEnrollments(supabase, liveClassIds, periodWindow.start, periodWindow.end),
    fetchRecords(supabase, liveClassIds, periodWindow.start, periodWindow.end),
  ]);

  const periodLabelOf = periodLabelFn(subjects, settings.operations);
  return buildSeatMonthly({
    month,
    window: periodWindow,
    days,
    holidays: buildHolidayMap(settings.operations.holidays),
    slots,
    classes: classes.map((c) => ({ id: c.id, className: c.class_name, subject: c.subject })),
    enrollments,
    records,
    wantLabel: want,
    periodLabelOf,
  });
}

function periodLabelFn(
  subjects: string[],
  operations: Parameters<typeof settingsToPeriodsConfig>[0],
): ((start: string, end: string) => string) | undefined {
  if (subjects.length !== 1) return undefined;
  const items = subjectWeekdayPeriods(subjects[0]!, settingsToPeriodsConfig(operations));
  const match = buildPeriodMatcher(items);
  return (start, end) => {
    const id = match({ startTime: start, endTime: end });
    const item = items.find((p) => p.id === id);
    return item ? periodSoloLabel(item) : start;
  };
}

async function fetchEnrollments(
  supabase: Awaited<ReturnType<typeof createClient>>,
  classIds: string[],
  start: string,
  end: string,
): Promise<SeatEnrollRow[]> {
  const rows = await fetchAllPagedInChunks<{
    class_id: string;
    start_date: string;
    end_date: string | null;
    on_hold: boolean;
    attendance_days: string[] | null;
    student: { id: string; name: string; school: string | null; grade: string | null }[] | { id: string; name: string; school: string | null; grade: string | null } | null;
  }>(classIds, (chunk, from, to) =>
    supabase
      .from("enrollments")
      .select("class_id, start_date, end_date, on_hold, attendance_days, student:student_id ( id, name, school, grade )")
      .in("class_id", chunk)
      .lte("start_date", end)
      .or(`end_date.is.null,end_date.gte.${start}`)
      .order("id")
      .range(from, to),
  );
  const out: SeatEnrollRow[] = [];
  for (const e of rows) {
    const s = (Array.isArray(e.student) ? e.student[0] : e.student) ?? null;
    if (!s) continue;
    out.push({
      classId: e.class_id,
      studentId: s.id,
      name: s.name,
      school: s.school,
      grade: s.grade,
      startDate: e.start_date,
      endDate: e.end_date,
      onHold: e.on_hold,
      attendanceDays: e.attendance_days,
    });
  }
  return out;
}

async function fetchRecords(
  supabase: Awaited<ReturnType<typeof createClient>>,
  classIds: string[],
  start: string,
  end: string,
): Promise<SeatAttRecord[]> {
  const rows = await fetchAllPagedInChunks<{
    id: string;
    class_id: string;
    student_id: string;
    session_date: string;
    slot_start: string | null;
    status: string;
    seat_label: string | null;
    session_units: number | string | null;
    recorded_at: string;
  }>(classIds, (chunk, from, to) =>
    supabase
      .from("attendance_records")
      .select("id, class_id, student_id, session_date, slot_start, status, seat_label, session_units, recorded_at")
      .in("class_id", chunk)
      .gte("session_date", start)
      .lte("session_date", end)
      .order("recorded_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to),
  );
  return effectiveAttendanceRecords(rows).map((r) => {
    const raw = r.session_units === null || r.session_units === undefined ? null : Number(r.session_units);
    return {
      id: r.id,
      classId: r.class_id,
      studentId: r.student_id,
      date: r.session_date,
      slotStart: r.slot_start,
      status: r.status,
      seatLabel: r.seat_label,
      sessionUnits: raw !== null && Number.isFinite(raw) ? raw : null,
    };
  });
}
