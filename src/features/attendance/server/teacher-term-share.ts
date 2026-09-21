import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { kstToday, monthRange } from "@/lib/date-kst";
import { lookupLabSeparateIds } from "@/features/classes/server/lab-separate";
import { toAutoUnitsSchedule } from "../auto-units";
import { rowKey } from "../grid/model";
import { teacherFourWeekWeights, teacherTermWeights, type TermShareWeights } from "../teacher-term-share";

export type TeacherTermScope = {
  teacherId: string;
  /** Only English classes; math keeps its existing registration basis. */
  classIds: readonly string[];
  holidays: readonly string[];
  homeroomSinceByClass?: Readonly<Record<string, string | null>>;
};

/** Called only after attendance visibility has restricted the roster. Read in bulk, within the tenant. */
export async function loadTeacherTermWeights(
  db: SupabaseClient,
  tenantId: string,
  month: string,
  roster: readonly { classId: string; studentIds: readonly string[] }[],
  scope: TeacherTermScope,
): Promise<Map<string, TermShareWeights>> {
  const classes = roster.filter((c) => scope.classIds.includes(c.classId));
  const ids = classes.map((c) => c.classId);
  if (!ids.length) return new Map();
  const { from, to } = monthRange(month);
  type ScheduleRow = Parameters<typeof toAutoUnitsSchedule>[0] & { id: string; class_id: string; teacher_id: string | null };
  type EnrollmentRow = { class_id: string; student_id: string; start_date: string; end_date: string | null; is_transferred: boolean; attendance_days: string[] | null };
  const [meta, schedules, enrollments, separate] = await Promise.all([
    fetchAllPagedInChunks<{ id: string; class_name: string; teacher_id: string | null; english_track: string | null }>(ids, (chunk, f, t) => db.from("classes")
      .select("id, class_name, teacher_id, english_track").eq("tenant_id", tenantId).in("id", chunk).order("id").range(f, t)),
    fetchAllPagedInChunks<ScheduleRow>(ids, (chunk, f, t) => db.from("class_schedules")
      .select("id, class_id, day_of_week, start_time, end_time, teacher_id, slot_teacher_label, valid_from, valid_to")
      .eq("tenant_id", tenantId).in("class_id", chunk).lte("valid_from", to).or(`valid_to.is.null,valid_to.gte.${from}`).order("id").range(f, t)),
    fetchAllPagedInChunks<EnrollmentRow>(ids, (chunk, f, t) => db.from("enrollments")
      .select("class_id, student_id, start_date, end_date, is_transferred, attendance_days")
      .eq("tenant_id", tenantId).in("class_id", chunk).lte("start_date", to).or(`end_date.is.null,end_date.gte.${from}`).order("id").range(f, t)),
    lookupLabSeparateIds(db, { kind: "window", from, to, tenantId, classIds: ids }),
  ]);
  if (typeof separate === "string") throw new Error("등록 차수 배분을 위한 LAB 시간표를 확인하지 못했습니다");
  const holidays = new Set(scope.holidays);
  const today = kstToday();
  const referenceDate = today < from ? from : today > to ? to : today;
  const result = new Map<string, TermShareWeights>();
  for (const cls of classes) {
    const info = meta.find((c) => c.id === cls.classId);
    const slots = schedules.filter((s) => s.class_id === cls.classId).map((s) => ({ ...toAutoUnitsSchedule(s), teacherId: s.teacher_id, labSeparate: separate.ids.has(s.id) }));
    const fourWeekWeights = info?.english_track === "eie" ? teacherFourWeekWeights({
      referenceDate, schedules: slots, homeroomTeacherId: info.teacher_id, className: info.class_name ?? "",
    }) : null;
    for (const studentId of cls.studentIds) {
      result.set(rowKey(cls.classId, studentId), fourWeekWeights ?? teacherTermWeights({
        month, schedules: slots, homeroomTeacherId: info?.teacher_id ?? null, englishTrack: info?.english_track ?? null, className: info?.class_name ?? "",
        holidays, scopeTeacherId: scope.teacherId, homeroomSince: scope.homeroomSinceByClass?.[cls.classId],
        // Hold has no historical start/end. A present-day hold must not erase a confirmed month's shares.
        enrollments: enrollments.filter((e) => e.class_id === cls.classId && e.student_id === studentId).map((e) => ({
          startDate: e.start_date, endDate: e.end_date, isTransferred: e.is_transferred, attendanceDays: e.attendance_days,
        })),
      }));
    }
  }
  return result;
}
