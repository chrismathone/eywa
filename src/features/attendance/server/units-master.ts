import "server-only";
import { redirect } from "next/navigation";
import { requireAccess } from "@/lib/auth/require-access";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged, fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { getTenantSettings } from "@/features/owner/server/queries";
import { getPeriodDefs } from "@/features/periods/server/queries";
import { resolvePeriodWindow } from "@/features/periods/resolve";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { lookupLabSeparateIds } from "@/features/classes/server/lab-separate";
import { toAutoUnitsSchedule, unitsFromMinutes, usesFortyMinuteEnglishUnits } from "../auto-units";
import { attendanceClassConfirmedSessions, attendanceInvoiceStateByStudent } from "../class-billing";
import { buildMasterStudent, masterOwner, masterPlan, type MasterClass, type MasterLesson, type MasterRecord, type UnitsMaster } from "../units-master";
import { rowKey } from "../grid/model";
import { kstDateTimeLocal, kstMonth } from "@/lib/date-kst";
import type { CurrentUser } from "@/lib/auth/current-user";
import { shiftDays } from "@/features/timetable/lib/week";
import { enrollmentAttendsOnDay, isEnrollmentEndedOn } from "@/features/enrollments/eligibility";
import { axisDowOf } from "../teacher-axis";
import { nativeLessonDraft } from "@/features/makeups/roster-merge";
import { loadNativeParticipants, participantsOrLegacy } from "@/features/makeups/server/adapters/participants";
import { taughtByColumnReady } from "./taught-by-db";

export function canViewUnitsMaster(role: CurrentUser["systemRole"], teacherId: string | null): boolean {
  return ["master", "admin", "manager"].includes(role) && !teacherId;
}

type ClassRow = { id: string; class_name: string; subject: "math" | "english"; teacher_id: string | null; english_track: string | null };
type EnrollmentRow = { class_id: string; student_id: string; start_date: string; end_date: string | null; is_transferred: boolean; attendance_days: string[] | null; on_hold: boolean };
type ScheduleRow = Parameters<typeof toAutoUnitsSchedule>[0] & { id: string; class_id: string; teacher_id: string | null };
type StudentRow = { id: string; name: string; school: string | null; grade: string | null };
type ReservationRow = { id: string; class_id: string; student_id: string; makeup_date: string; slot_start: string; slot_end: string };
type InvoiceRow = { id: string; student_id: string; status: string | null };
type TermRow = Parameters<typeof attendanceClassConfirmedSessions>[2][number] & { id: string };

/** A read-only bulk query. Every admin query is tenant-scoped; no client-supplied class/student IDs. */
export async function loadUnitsMaster(requestedMonth: string): Promise<UnitsMaster> {
  const user = await requireAccess("attendance");
  if (!canViewUnitsMaster(user.systemRole, await effectiveTeacherId())) redirect("/attendance?list=1");
  const month = /^(20\d{2})-(0[1-9]|1[0-2])$/.test(requestedMonth) ? requestedMonth : kstMonth();
  const asOf = kstDateTimeLocal();
  const db = createAdminClient();
  const [classes, defs, { operations }, invoices, taughtByReady] = await Promise.all([
    fetchAllPaged<ClassRow>((f, t) => db.from("classes").select("id, class_name, subject, teacher_id, english_track")
      .eq("tenant_id", user.tenantId).in("subject", ["math", "english"]).order("id").range(f, t)),
    getPeriodDefs(Number(month.slice(0, 4))), getTenantSettings(),
    fetchAllPaged<InvoiceRow>((f, t) => db.from("invoices").select("id, student_id, status")
      .eq("tenant_id", user.tenantId).eq("period", month).order("id").range(f, t)),
    taughtByColumnReady(db),
  ]);
  if (!classes.length) return { month, asOf, classes: [] };
  const windows = new Map(classes.map((c) => [c.id, resolvePeriodWindow({ period: month, subjectKey: c.subject, classId: c.id, defs })]));
  const from = [...windows.values()].map((w) => w.start).sort()[0];
  const to = [...windows.values()].map((w) => w.end).sort().at(-1)!;
  const ids = classes.map((c) => c.id);
  const liveInvoices = invoices.filter((i) => i.status !== "void");
  const [enrollments, schedules, records, terms, separate, reservations] = await Promise.all([
    fetchAllPagedInChunks<EnrollmentRow>(ids, (chunk, f, t) => db.from("enrollments")
      .select("class_id, student_id, start_date, end_date, is_transferred, attendance_days, on_hold")
      .eq("tenant_id", user.tenantId).in("class_id", chunk).lte("start_date", to).or(`end_date.is.null,end_date.gte.${from}`).order("id").range(f, t)),
    fetchAllPagedInChunks<ScheduleRow>(ids, (chunk, f, t) => db.from("class_schedules")
      .select("id, class_id, day_of_week, start_time, end_time, teacher_id, slot_teacher_label, valid_from, valid_to")
      .eq("tenant_id", user.tenantId).in("class_id", chunk).lte("valid_from", to).or(`valid_to.is.null,valid_to.gte.${from}`).order("id").range(f, t)),
    fetchAllPagedInChunks<MasterRecord>(ids, (chunk, f, t) => db.from("attendance_records")
      .select(taughtByReady
        ? "id, class_id, student_id, session_date, slot_start, status, session_units, seat_label, recorded_via, recorded_at, taught_by"
        : "id, class_id, student_id, session_date, slot_start, status, session_units, seat_label, recorded_via, recorded_at")
      .eq("tenant_id", user.tenantId).in("class_id", chunk).gte("session_date", from).lte("session_date", to).order("id").range(f, t)
      .overrideTypes<MasterRecord[], { merge: false }>()),
    fetchAllPagedInChunks<TermRow>(liveInvoices.map((i) => i.id), (chunk, f, t) => db.from("invoice_session_terms")
      .select("id, invoice_id, class_id, confirmed_sessions, quantity_basis, pricing_mode")
      .eq("tenant_id", user.tenantId).in("invoice_id", chunk).order("id").range(f, t)),
    lookupLabSeparateIds(db, { kind: "window", from, to, tenantId: user.tenantId, classIds: ids }),
    fetchAllPagedInChunks<ReservationRow>(ids, (chunk, f, t) => db.from("makeup_reservations")
      .select("id, class_id, student_id, makeup_date, slot_start, slot_end")
      .eq("tenant_id", user.tenantId).in("class_id", chunk).eq("status", "reserved")
      .gte("makeup_date", from).lte("makeup_date", to).order("id").range(f, t)),
  ]);
  if (typeof separate === "string") throw new Error("*LAB 시간표를 확인하지 못했습니다. 다시 시도해 주세요.");
  const studentByInvoice = new Map(liveInvoices.map((i) => [i.id, i.student_id]));
  const termsByClass = groupBy(terms, (t) => t.class_id ?? "");
  const recordsByClass = groupBy(records, (r) => r.class_id);
  const enrollmentsByClass = groupBy(enrollments, (e) => e.class_id);
  const schedulesByClass = groupBy(schedules, (s) => s.class_id);
  const reservationsByClass = groupBy(reservations, (r) => r.class_id);
  const nativeRows = participantsOrLegacy(await loadNativeParticipants({ date_from: from, date_to: to, limit: 500 }, { sharedRead: true }));
  const roster = classes.map((c) => {
    const w = windows.get(c.id)!;
    return { classId: c.id, className: c.class_name, studentIds: [...new Set([
      ...(enrollmentsByClass.get(c.id) ?? []).filter((e) => e.start_date <= w.end && !isEnrollmentEndedOn(e.end_date, w.start, e.is_transferred)).map((e) => e.student_id),
      ...(recordsByClass.get(c.id) ?? []).filter((r) => r.session_date >= w.start && r.session_date <= w.end).map((r) => r.student_id),
      ...(termsByClass.get(c.id) ?? []).flatMap((t) => studentByInvoice.get(t.invoice_id) ?? []),
      ...(reservationsByClass.get(c.id) ?? []).map((r) => r.student_id),
      ...nativeRows.filter((row) => row.classId === c.id).map((row) => row.studentId),
    ])] };
  });
  const studentIds = [...new Set(roster.flatMap((r) => r.studentIds))];
  const teacherIds = [...new Set([...classes.map((c) => c.teacher_id), ...schedules.map((s) => s.teacher_id), ...records.map((r) => r.taught_by)].filter((id): id is string => !!id))];
  const [students, teachers] = await Promise.all([
    fetchAllPagedInChunks<StudentRow>(studentIds, (chunk, f, t) => db.from("students").select("id, name, school, grade")
      .eq("tenant_id", user.tenantId).in("id", chunk).order("id").range(f, t)),
    fetchAllPagedInChunks<{ id: string; display_name: string }>(teacherIds, (chunk, f, t) => db.from("users").select("id, display_name")
      .eq("tenant_id", user.tenantId).in("id", chunk).order("id").range(f, t)),
  ]);
  const studentMap = new Map(students.map((s) => [s.id, s]));
  const teacherNames = new Map(teachers.map((t) => [t.id, t.display_name]));
  const confirmed = attendanceClassConfirmedSessions(roster, liveInvoices, terms);
  // A partially confirmed student/class is still unconfirmed; do not compare a partial target.
  for (const t of terms) if (t.confirmed_sessions === null && t.class_id) {
    const studentId = studentByInvoice.get(t.invoice_id);
    if (studentId) delete confirmed[rowKey(t.class_id, studentId)];
  }
  const invoiceStates = attendanceInvoiceStateByStudent(studentIds, invoices);
  const holidays = new Set((operations.holidays ?? []).map((h) => h.date));
  const result: MasterClass[] = [];
  for (const c of classes) {
    const rosterRow = roster.find((r) => r.classId === c.id)!;
    if (!rosterRow.studentIds.length) continue;
    const w = windows.get(c.id)!;
    const slots = (schedulesByClass.get(c.id) ?? []).map((s) => ({ ...toAutoUnitsSchedule(s), teacherId: s.teacher_id, labSeparate: separate.ids.has(s.id) }));
    const referenceDate = asOf.slice(0, 10) < w.start ? w.start : asOf.slice(0, 10) > w.end ? w.end : asOf.slice(0, 10);
    const basis40 = c.subject === "english" && usesFortyMinuteEnglishUnits(referenceDate, slots, c.english_track, c.class_name);
    const track = c.subject === "math" ? "math" : c.english_track === "eie" ? "eie" : basis40 ? "bridge" : "hourly";
    const unitTrack = c.subject === "math" ? "math" : basis40 ? "eie" : "injaewon";
    const planInput = { subject: c.subject, schedules: slots, homeroomTeacherId: c.teacher_id, englishTrack: c.english_track, className: c.class_name, holidays };
    const plan = masterPlan({ ...planInput, from: w.start, to: w.end });
    const fixedWeek = track === "eie" ? masterPlan({ ...planInput, from: referenceDate, to: shiftDays(referenceDate, 6), holidays: new Set(),
      schedules: slots.filter((s) => s.validFrom <= referenceDate && (!s.validTo || s.validTo >= referenceDate))
        .map((s) => ({ ...s, validFrom: referenceDate, validTo: null })) }) : null;
    // Four-week registration does not invent dates. If the period's weekday counts differ, flag it explicitly.
    const weekdayCounts = new Map<string, Set<string>>();
    for (const l of plan) { const key = axisDowOf(l.date)!; const dates = weekdayCounts.get(key) ?? new Set(); dates.add(l.date); weekdayCounts.set(key, dates); }
    const sessionUnmapped = track === "eie" && [...weekdayCounts.values()].some((dates) => dates.size !== 4);
    const rows = rosterRow.studentIds.flatMap((id) => {
      const s = studentMap.get(id); if (!s) throw new Error("학생 명단을 모두 확인하지 못했습니다");
      const enrollmentRows = (enrollmentsByClass.get(c.id) ?? []).filter((e) => e.student_id === id);
      const enrollment = enrollmentRows.map((e) => ({ startDate: e.start_date, endDate: e.end_date, isTransferred: e.is_transferred, attendanceDays: e.attendance_days }));
      const studentPlan = plan.filter((l) => enrollment.some((e) => e.startDate <= l.date && !isEnrollmentEndedOn(e.endDate, l.date, e.isTransferred)
        && enrollmentAttendsOnDay(e.attendanceDays, axisDowOf(l.date)!)));
      const allocation = new Map<string, number>();
      for (const l of fixedWeek ?? studentPlan) allocation.set(l.owner, (allocation.get(l.owner) ?? 0) + l.units * (fixedWeek ? 4 : 1));
      const upcoming: MasterLesson[] = (reservationsByClass.get(c.id) ?? []).filter((r) => r.student_id === id && r.makeup_date >= w.start && r.makeup_date <= w.end)
        .map((r) => { const start = r.slot_start.slice(0, 5), end = r.slot_end.slice(0, 5);
          const minutes = Number(end.slice(0, 2)) * 60 + Number(end.slice(3)) - Number(start.slice(0, 2)) * 60 - Number(start.slice(3));
          return { date: r.makeup_date, start, end, owner: masterOwner(slots, c.teacher_id, r.makeup_date, start), units: unitsFromMinutes(minutes, unitTrack) ?? 1 };
        });
      const nativeReviews: string[] = [];
      for (const piece of nativeRows.filter((row) => row.classId === c.id && row.studentId === id && row.sessionDate >= w.start && row.sessionDate <= w.end)) {
        const draft = nativeLessonDraft(piece);
        if (!draft || !("date" in draft)) {
          if (draft && "review" in draft) nativeReviews.push(draft.review);
          continue;
        }
        if (upcoming.some((lesson) => lesson.date === draft.date && lesson.start === draft.start)) continue;
        const minutes = Number(draft.end.slice(0, 2)) * 60 + Number(draft.end.slice(3)) - Number(draft.start.slice(0, 2)) * 60 - Number(draft.start.slice(3));
        upcoming.push({ date: draft.date, start: draft.start, end: draft.end, owner: masterOwner(slots, c.teacher_id, draft.date, draft.start), units: unitsFromMinutes(minutes, unitTrack) ?? 1 });
      }
      const row = buildMasterStudent({ student: { id, name: s.name, school: schoolGradeLabel(s.school, s.grade) },
        records: recordsByClass.get(c.id) ?? [], schedules: slots, enrollments: enrollment, plan, allocation,
        term: confirmed[rowKey(c.id, id)], invoice: invoiceStates[id], homeroomTeacherId: c.teacher_id,
        from: w.start, to: w.end, asOf, sessionUnmapped, reservations: upcoming });
      for (const message of nativeReviews) row.review.push(message);
      if (nativeReviews.length && row.target !== null) row.status = "review";
      if (enrollmentRows.some((e) => e.on_hold)) {
        row.review.push("현재 휴원 상태입니다. 해당 기간의 출결을 확인해 주세요");
        if (row.target !== null) row.status = "review";
      }
      return [row];
    }).sort((a, b) => a.name.localeCompare(b.name, "ko"));
    const owners = [...new Set(rows.flatMap((r) => Object.keys(r.owners)))];
    result.push({ id: c.id, name: c.class_name, subject: c.subject, track, from: w.start, to: w.end, periodLabel: w.label,
      teachers: owners.filter((id) => !["JJ", "LAB"].includes(id)).map((id) => ({ id, name: teacherNames.get(id) ?? "귀속 확인" })), students: rows });
  }
  return { month, asOf, classes: result.sort((a, b) => a.name.localeCompare(b.name, "ko")) };
}

function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) { const id = key(row); const list = out.get(id) ?? []; list.push(row); out.set(id, list); }
  return out;
}
