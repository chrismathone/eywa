import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { getHomeroomHistoryIndex } from "@/features/classes/server/teacher-as-of-queries";
import { homeroomTeacherOnDate } from "@/features/classes/teacher-as-of";
import { foldedReason } from "@/lib/folded-read";
import { kstDateOf } from "@/lib/date-kst";
import { resolvePastClassTeacher, type PastClassTarget, type PastTeacher, type TeacherEvidence } from "../lib/past-class-teacher";

/** 학생 상세의 지난 수업 표시 전용. 추정값은 담당 배정·권한·시수 정산을 변경하지 않는다. */
export async function getPastClassTeachers(targets: readonly PastClassTarget[]): Promise<Map<string, PastTeacher>> {
  const result = new Map<string, PastTeacher>();
  if (!targets.length) return result;
  const db = await createClient();
  const classIds = [...new Set(targets.map(r => r.classId))];
  const [history, classes] = await Promise.all([
    getHomeroomHistoryIndex(),
    fetchInChunks<{ id: string; teacher_id: string | null; created_at: string }>(classIds, ids => db.from("classes").select("id, teacher_id, created_at").in("id", ids)),
  ]);
  const classById = new Map(classes.map(r => [r.id, r]));
  const current = new Map(classes.map(r => [r.id, r.teacher_id]));
  const assignedIds = new Map(targets.map(t => [t.enrollmentId, history.get(t.classId)?.length
    ? homeroomTeacherOnDate(history.get(t.classId), current.get(t.classId) ?? null, t.lastDate) : null]));
  // 수강 시작일에 생성된 반에 담당 변경 이력이 없으면, 마지막 근거로 현재 배정 강사를 추정 표시한다.
  // 기존 반·변경 이력이 있는 반·이력 조회 실패는 현재 담당을 과거 담당으로 소급하지 않는다.
  const currentFallbackIds = new Map<string, string>();
  if (!foldedReason(history)) for (const t of targets) {
    const klass = classById.get(t.classId);
    if (history.get(t.classId)?.length || !klass?.teacher_id || kstDateOf(klass.created_at) !== t.startDate) continue;
    currentFallbackIds.set(t.enrollmentId, klass.teacher_id);
  }
  const ids = [...new Set([...assignedIds.values(), ...currentFallbackIds.values()].filter((v): v is string => !!v))];
  const teachers = await fetchInChunks<{ id: string; display_name: string | null }>(ids, chunk => db.from("users").select("id, display_name").in("id", chunk));
  const names = new Map(teachers.map(t => [t.id, t.display_name]));
  const missing = targets.filter(t => !names.get(assignedIds.get(t.enrollmentId) ?? ""));
  let reports: TeacherEvidence[] = [];
  let attendance: TeacherEvidence[] = [];
  if (missing.length) {
    const missingIds = [...new Set(missing.map(t => t.classId))];
    const from = missing.reduce((d, t) => t.startDate < d ? t.startDate : d, missing[0]!.startDate);
    const to = missing.reduce((d, t) => t.lastDate > d ? t.lastDate : d, missing[0]!.lastDate);
    const [reportRows, attendanceRows] = await Promise.all([
      fetchAllPagedInChunks<{ class_id: string; report_date: string; teacher_name: string | null }>(missingIds, (chunk, f, t) => db
        .from("lesson_reports").select("class_id, report_date, teacher_name").in("class_id", chunk)
        .lte("report_date", to).or("makeup.is.null,makeup.eq.false")
        .is("revoked_at", null).order("id").range(f, t)),
      fetchAllPagedInChunks<{ class_id: string; session_date: string; recorder: { display_name: string | null } | { display_name: string | null }[] | null }>(missingIds, (chunk, f, t) => db
        .from("attendance_records").select("class_id, session_date, recorder:recorded_by ( display_name )").in("class_id", chunk)
        .gte("session_date", from).lte("session_date", to).eq("recorded_via", "teacher")
        .is("seat_label", null).in("status", ["present", "late", "early_leave"]).order("id").range(f, t)),
    ]);
    reports = reportRows.map(r => ({ classId: r.class_id, date: r.report_date, name: r.teacher_name ?? "" }));
    attendance = attendanceRows.map(r => ({ classId: r.class_id, date: r.session_date,
      name: (Array.isArray(r.recorder) ? r.recorder[0] : r.recorder)?.display_name ?? "" }));
  }
  for (const t of targets) {
    const resolved = resolvePastClassTeacher(t, names.get(assignedIds.get(t.enrollmentId) ?? "") ?? null, reports, attendance,
      names.get(currentFallbackIds.get(t.enrollmentId) ?? "") ?? null);
    if (resolved) result.set(t.enrollmentId, resolved);
  }
  return result;
}
