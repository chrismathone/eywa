import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { isFeatureLicensed } from "@/lib/license/server";
import { getAssignedVideoHomework } from "@/features/video-homework/server/assignments";
import { loadClassVideos } from "@/features/video-homework/server/ledger-queries";
import type { VideoHomeworkMark, VideoHomeworkStatus } from "@/features/video-homework/types";
import type { SnapshotAttendance } from "@/features/teacher-portfolio/model/types";
import { normalizeEvaluationGrades, type RawGrade, type RawReport } from "@/features/teacher-portfolio/server/evaluation-sources";
import type { RankingGrade } from "../model/ranking-facts";
import { currentSignals, loadSignalRows, loadSignalSources, signalKey } from "./signals";
import type { CoreSources } from "./source-types";

export async function loadActivities(db: SupabaseClient, tenant: string, today: string, core: CoreSources) {
  const table = <Columns extends string>(name: string, columns: Columns) => db.from(name).select(columns).eq("tenant_id", tenant);
  const from = "2026-01-01";
  const [attendance, grades, schoolRows, reports, assignments, marks, signalRows, signalSources, aiLicensed] = await Promise.all([
    fetchAllPaged<SnapshotAttendance>((a, b) => table("attendance_records", "id, student_id, class_id, session_date, slot_start, status, recorded_at, supersedes_id, seat_label, recorded_via, taught_by, note")
      .gte("session_date", from).lte("session_date", today).order("id").range(a, b)),
    fetchAllPaged<RawGrade>((a, b) => table("student_grades", "id, student_id, exam_name, exam_slot, subject, class_id, score, max_score, taken_on, no_exam, created_at")
      .gte("taken_on", from).lte("taken_on", today).order("id").range(a, b)),
    // 로열티 랭킹의 학교 성적은 2026년 이전 학교 시험도 쓴다(향상 비교의 직전 시험). DB에서 학교 시험 후보만 거르고(월말·일일 테스트 제외) 최종 판별은 schoolRankingFacts가 한다.
    fetchAllPaged<RankingGrade>((a, b) => table("student_grades", "id, student_id, exam_name, exam_slot, subject, score, max_score, taken_on, no_exam, school_year")
      .lte("taken_on", today).or("exam_slot.in.(midterm,final,listening,school),and(exam_slot.is.null,or(exam_name.ilike.*중간*,exam_name.ilike.*기말*,exam_name.ilike.*듣기*,exam_name.ilike.*내신*))")
      .order("id").range(a, b)),
    fetchAllPaged<RawReport>((a, b) => table("lesson_reports", "id, student_id, class_id, subject, report_date, created_at, daily_test, check_test, exam_info")
      .gte("report_date", from).lte("report_date", today).or("daily_test.not.is.null,check_test.not.is.null,exam_info.not.is.null").order("id").range(a, b)),
    getAssignedVideoHomework(tenant, from, today),
    fetchAllPaged<{ class_id: string; student_id: string; check_date: string; homework_date: string; status: string }>((a, b) =>
      table("video_homework_marks", "class_id, student_id, check_date, homework_date, status").gte("homework_date", from).lte("homework_date", today).order("id").range(a, b)),
    loadSignalRows(db, tenant), loadSignalSources(db, tenant), isFeatureLicensed(tenant, "ai_analysis"),
  ]);
  // 실패를 '영상 0개'로 굳히지 않는다. 모든 활동 원본이 준비된 실행만 월 행을 저장한다.
  if (assignments === null) throw new Error("영상 숙제 원자료를 읽지 못해 집계를 중단했습니다");
  const videos = await loadClassVideos(tenant, [...new Set(assignments.map((a) => a.studentId))], from, today, true);
  if (videos === null) throw new Error("영상 제출 원자료를 읽지 못해 집계를 중단했습니다");
  const students = new Map(core.students.map((s) => [s.id, s]));
  const classes = new Map(core.classes.map((c) => [c.id, c]));
  const normalized = normalizeEvaluationGrades({ grades, reports }, { isTest: (id) => students.get(id)?.is_test !== false,
    subjectOfClass: (id) => classes.get(id)?.subject ?? null });
  const saved = new Map(signalRows.map((r) => [`${r.source}:${r.source_id}`, r]));
  const pendingSignals = signalSources.filter((s) => !saved.has(signalKey(s)) || saved.get(signalKey(s))?.rejudge_requested_at
    || saved.get(signalKey(s))?.source_hash !== s.hash);
  return { attendance, grades: normalized, schoolGrades: schoolRows.filter(g => students.get(g.student_id)?.is_test === false), assignments, videos,
    marks: marks.map((r): VideoHomeworkMark => ({ classId: r.class_id, studentId: r.student_id, checkDate: r.check_date,
      homeworkDate: r.homework_date, status: r.status as VideoHomeworkStatus })),
    signals: currentSignals(signalRows, signalSources), signalRows, signalSources, pendingSignals, aiLicensed };
}
type LoadedActivities = Awaited<ReturnType<typeof loadActivities>>;
export type ActivitySources = Omit<LoadedActivities, "schoolGrades"> & { schoolGrades?: LoadedActivities["schoolGrades"] };
