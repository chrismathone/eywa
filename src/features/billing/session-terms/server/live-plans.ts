import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { toAutoUnitsSchedule } from "@/features/attendance/auto-units";
import { planTermsForMonth, monthRange } from "../plan";
import type { TransferEnrollment } from "../receipt-suggestion";

export type PlanHistory = TransferEnrollment & {
  student_id: string; on_hold: boolean; attendance_days: string[] | null;
  class: { subject?: string; is_active?: boolean } | { subject?: string; is_active?: boolean }[] | null;
};
const dow: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
/** 조회 시 최신 수강 기간으로 계산한다. DB의 오래된 계획값을 0시수의 대체값으로 쓰지 않는다. */
export async function loadLivePlans(db: Awaited<ReturnType<typeof createClient>>, period: string, studentIds: string[], holidays: string[]) {
  const range = monthRange(period);
  const plans = new Map<string, Map<string, number>>();
  if (!range || !studentIds.length) return { plans, history: [] as PlanHistory[] };
  const previousDay = new Date(Date.parse(range.start) - 86400000).toISOString().slice(0, 10);
  const history = await fetchAllPagedInChunks<PlanHistory>(studentIds, (ids, from, to) => db.from("enrollments")
    .select("student_id, class_id, start_date, end_date, on_hold, attendance_days, is_transferred, is_transferred_in, class:class_id!inner (subject, is_active)")
    .in("student_id", ids).lte("start_date", range.end).or(`end_date.is.null,end_date.gte.${previousDay}`).order("id").range(from, to));
  const classIds = [...new Set(history.map((e) => e.class_id))];
  const schedules = await fetchAllPagedInChunks<Parameters<typeof toAutoUnitsSchedule>[0] & { class_id: string }>(classIds, (ids, from, to) => db.from("class_schedules")
    .select("class_id, day_of_week, start_time, end_time, valid_from, valid_to, slot_teacher_label")
    .in("class_id", ids).lte("valid_from", range.end).or(`valid_to.is.null,valid_to.gte.${range.start}`).order("id").range(from, to));
  for (const studentId of studentIds) {
    const enrollments = history.filter((e) => e.student_id === studentId && !e.on_hold).flatMap((e) => {
      const cls = Array.isArray(e.class) ? e.class[0] : e.class;
      if (!cls?.subject || cls.is_active === false) return [];
      return [{ classId: e.class_id, subject: cls.subject, startDate: e.start_date, endDate: e.end_date, isTransferred: e.is_transferred,
        weekdays: [], attendanceDays: (e.attendance_days ?? []).map((day) => dow[day]).filter((day) => day !== undefined),
        schedules: schedules.filter((s) => s.class_id === e.class_id).map(toAutoUnitsSchedule) }];
    });
    plans.set(studentId, new Map(planTermsForMonth(period, enrollments, holidays).map((p) => [p.classId, p.plannedSessions])));
  }
  return { plans, history };
}
