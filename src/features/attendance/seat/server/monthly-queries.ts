import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged, fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { addDays, kstToday } from "@/lib/date-kst";
import { TRANSFER_GAP_DAYS, clipToWithdrawal } from "@/features/attendance/enrollment-span";
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
// *LAB 재료 — 켠 교시(0271a)·켠 수강(0271b). 둘 다 fail-soft.
import { loadLabSeparateIds } from "@/features/classes/server/lab-separate";
import { loadLabSplitCellsForClasses } from "./lab-split";
import { hhmm, SEAT_DB_LABEL, type SeatKey } from "../seat";
import { buildMonthDays, isSlotLiveOnDate, padDaysTo31, type SeatAttRecord, type SeatSlotDef } from "../monthly";
import {
  buildSeatMonthly,
  type SeatEnrollRow,
  type SeatMonthlyView,
  type SeatOtherSpan,
} from "../monthly-build";

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

  // '따로 수업(*LAB)' 켠 교시(0271a) — 배치 조회와 **병렬**(B4), 따로·fail-soft([[#95]]). 모르면 안 가른다.
  const [rawSlots, settings, labSeparateSlotIds] = await Promise.all([
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
    loadLabSeparateIds(supabase, { kind: "window", from: qStart, to: qEnd }),
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
      separate: labSeparateSlotIds ? labSeparateSlotIds.has(String(r.id)) : undefined,
    }))
    .filter((s) => days.some((d) => !d.placeholder && isSlotLiveOnDate(s, d.date)));

  const liveClassIds = [...new Set(slots.map((s) => s.classId))];
  // '따로 수업(*LAB)' 재료 — 켠 교시(0271a)·켠 수강(0271b). 둘 다 따로·fail-soft([[#95]]), 모르면 안 가른다.
  const [enrollments, records, labFlagged] = await Promise.all([
    fetchEnrollments(supabase, liveClassIds, periodWindow.start, periodWindow.end),
    fetchRecords(supabase, liveClassIds, periodWindow.start, periodWindow.end),
    loadLabSplitCellsForClasses(supabase, { classIds: liveClassIds, tenantId: null }),
  ]);

  // 표식(퇴원/반이동) 판정용 — 그 학생들의 **다른 반** 수강. 반이동은 떠난 뒤 14일 안에 시작한 반을
  // 보므로 창을 그만큼 넓혀 읽는다(안 넓히면 월말 반이동이 '퇴원'으로 보인다).
  const otherSpans = await fetchOtherSpans(
    supabase,
    [...new Set(enrollments.map((e) => e.studentId))],
    addDays(periodWindow.start, -TRANSFER_GAP_DAYS),
    addDays(periodWindow.end, TRANSFER_GAP_DAYS),
  );

  const periodLabelOf = periodLabelFn(subjects, settings.operations);
  return buildSeatMonthly({
    otherSpans,
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
    // 🔴 켠 교시를 모르면(labSeparateSlotIds=null) 배정도 안 넘긴다 — 한쪽만 알면 전부 "끈 원생"으로 읽혀 *LAB 칸이 비어 버린다.
    labFlagged: labSeparateSlotIds ? labFlagged : null,
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
    is_transferred: boolean | null;
    on_hold: boolean;
    attendance_days: string[] | null;
    student: { id: string; name: string; school: string | null; grade: string | null }[] | { id: string; name: string; school: string | null; grade: string | null } | null;
  }>(classIds, (chunk, from, to) =>
    supabase
      .from("enrollments")
      // is_transferred 없이는 반이동 종료를 일반 종료로 오인해 **옛 반 칸이 적용일 하루 더 재원**으로 그려진다.
      .select(
        "class_id, start_date, end_date, is_transferred, on_hold, attendance_days, student:student_id ( id, name, school, grade )",
      )
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
      isTransferred: e.is_transferred === true,
      onHold: e.on_hold,
      attendanceDays: e.attendance_days,
    });
  }
  return out;
}

/** 학생별 전(全) 반 수강 구간 — 표식 판정에만 쓴다(자리 반 자신은 조립부에서 뺀다). */
async function fetchOtherSpans(
  supabase: Awaited<ReturnType<typeof createClient>>,
  studentIds: string[],
  start: string,
  end: string,
): Promise<Map<string, SeatOtherSpan[]>> {
  const out = new Map<string, SeatOtherSpan[]>();
  if (studentIds.length === 0) return out;
  const rows = await fetchAllPagedInChunks<{
    student_id: string;
    class_id: string;
    start_date: string;
    end_date: string | null;
    is_transferred: boolean | null;
    class: { class_name: string; subject: string | null }[] | { class_name: string; subject: string | null } | null;
    student: { withdrawn_at: string | null }[] | { withdrawn_at: string | null } | null;
  }>(studentIds, (chunk, from, to) =>
    supabase
      .from("enrollments")
      // 🔴 `is_transferred` — 같은 날 이어받은 반이동을 새 반에서도 알아보려면 이 표식이 필요하다(적대 리뷰 2026-09-14).
      // `withdrawn_at` — 그만둔 학생의 다른 반을 퇴원일로 잘라 '종강'(계속 수강)으로 안 읽히게(clipToWithdrawal). 같은 행이라 왕복 0.
      .select(
        "student_id, class_id, start_date, end_date, is_transferred, class:class_id ( class_name, subject ), student:student_id ( withdrawn_at )",
      )
      .in("student_id", chunk)
      .lte("start_date", end)
      .or(`end_date.is.null,end_date.gte.${start}`)
      .order("id")
      .range(from, to),
  );
  for (const r of rows) {
    const c = (Array.isArray(r.class) ? r.class[0] : r.class) ?? null;
    const stu = (Array.isArray(r.student) ? r.student[0] : r.student) ?? null;
    const list = out.get(r.student_id) ?? [];
    list.push(
      clipToWithdrawal(
        {
          classId: r.class_id,
          className: c?.class_name ?? "다른 반",
          subject: c?.subject ?? null,
          start: r.start_date,
          end: r.end_date,
          isTransferred: r.is_transferred === true,
        },
        stu?.withdrawn_at,
      ),
    );
    out.set(r.student_id, list);
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
