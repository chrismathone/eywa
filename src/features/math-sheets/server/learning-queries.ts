import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { requireMcsClassAccess } from "./access";
import type { MathSheetMonthData } from "./month-queries";
import {
  buildLearningProgress,
  normalizeLearningGoal,
  type LearningData,
  type LearningGoal,
  type LearningRecord,
} from "../lib/learning-plan";
import { monthRange } from "@/lib/date-kst";
import { readMathLearningTrack } from "./learning-track";
import { buildLearningHistory } from "../lib/learning-history";

export async function getMathLearningData(
  classId: string,
  monthData: MathSheetMonthData,
  options: { studentId?: string; allRecords?: boolean; forRevision?: boolean } = {},
): Promise<LearningData> {
  const gate = await requireMcsClassAccess(classId);
  const endOfMonth = monthRange(monthData.month).to;
  const referenceDate =
    endOfMonth < monthData.today ? endOfMonth : monthData.today;
  const result: LearningData = {
    goals: {},
    progress: {},
    records: {},
    status: "ok",
    referenceDate,
    context: monthData.learningContext ?? {
      schedules: [],
      holidays: {},
      spans: {},
    },
  };
  if (!gate.ok) return { ...result, status: "failed" };
  const admin = createAdminClient(),
    tenantId = gate.access.tenantId;
  const track = await readMathLearningTrack(tenantId, classId);
  if (!track) return { ...result, status: "failed" };
  result.track = track;
  const [legacy, standard] = await Promise.all([admin
    .from("math_learning_goals")
    .select(
      "student_id, study_grade, start_block, end_block, start_date, end_date, textbook",
    )
    .eq("tenant_id", tenantId)
    .eq("class_id", classId), admin
    .from("math_learning_track_goals")
    .select("student_id, study_grade, end_study_grade, start_block, end_block, start_date, end_date, textbook, track, block_count, milestones, updated_at, plan_revision")
    .eq("tenant_id", tenantId)
    .eq("class_id", classId)
    .eq("track", track)
    .lte("start_date", endOfMonth)
    .order("start_date")]);
  const error = legacy.error ?? standard.error;
  if (error)
    return {
      ...result,
      status: ["42P01", "PGRST205"].includes(error.code)
        ? "missing-table"
        : "failed",
    };
  const visibleIds = new Set(monthData.students.filter(s => !options.studentId || s.studentId === options.studentId).map((s) => s.studentId));
  for (const row of [...(legacy.data ?? []).map((row) => ({ ...row, track: "regular", block_count: null as number | null, end_study_grade: null, milestones: [], updated_at: undefined, plan_revision: null })), ...(standard.data ?? [])]) {
    if (!visibleIds.has(String(row.student_id)) || row.track !== track) continue;
    const goal: LearningGoal = {
      studentId: String(row.student_id),
      studyGrade: row.study_grade,
      endStudyGrade: row.end_study_grade ?? undefined,
      startBlock: row.start_block,
      endBlock: row.end_block,
      startDate: row.start_date,
      endDate: row.end_date,
      textbook: row.textbook,
      track: row.track === "supplement" ? "supplement" : "regular",
      blockCount: row.block_count,
      milestones: row.milestones,
      updatedAt: row.updated_at,
      revision: row.plan_revision ?? null,
    };
    result.goals[goal.studentId] = normalizeLearningGoal(goal);
  }
  if (!visibleIds.size) return result;
  type Row = {
    student_id: string;
    report_date: string;
    progress: string | null;
    textbook: string | null;
    homework_today: string | null;
    classnote_sent_at: string | null;
  };
  type Enrollment = { student_id: string; class_id: string; start_date: string | null; end_date: string | null };
  try {
    const [records, students, enrollments] = await Promise.all([fetchAllPagedInChunks<Row>(
      [...visibleIds],
      (chunk, from, to) =>
        admin
          .from("lesson_reports")
          .select("student_id, report_date, progress, textbook, homework_today, classnote_sent_at")
          .eq("tenant_id", tenantId)
          .eq("class_id", classId)
          .in("student_id", chunk)
          // Keep the last known unit before the plan starts, including during exam preparation.
          // A student's other classes may teach different courses, so class_id stays required.
          // Synthetic demo reports are local preview facts; no parent delivery is fabricated.
          .or("classnote_status.eq.success,classnote_sent_at.not.is.null,edutrix_share_token.not.is.null,source.eq.demo_history")
          .is("revoked_at", null)
          .lte("report_date", referenceDate)
          .order("report_date")
          .order("classnote_sent_at", { nullsFirst: true })
          .order("id")
          .range(from, to),
    ), fetchInChunks<{ id: string; enrolled_at: string | null }>([...visibleIds], chunk => admin.from("students")
      .select("id, enrolled_at").eq("tenant_id", tenantId).in("id", chunk)),
    fetchAllPagedInChunks<Enrollment>([...visibleIds], (chunk, from, to) => admin.from("enrollments")
      .select("student_id, class_id, start_date, end_date").eq("tenant_id", tenantId).in("student_id", chunk)
      .order("id").range(from, to))]);
    const previousEnrollments = enrollments.filter(enrollment => {
      if (enrollment.class_id === classId || !enrollment.end_date) return false;
      const currentStart = enrollments.filter(item => item.student_id === enrollment.student_id && item.class_id === classId && item.start_date)
        .map(item => item.start_date!).sort()[0];
      return currentStart != null && enrollment.end_date <= currentStart;
    });
    const previousClassIds = [...new Set(previousEnrollments.map(item => item.class_id))];
    // Historical, completed enrollments only: concurrent regular/supplement classes never replace this class's current progress.
    const previousRecords = previousClassIds.length ? await fetchAllPagedInChunks<Row & { class_id: string }>(
      [...visibleIds], (chunk, from, to) => admin.from("lesson_reports")
        .select("student_id, class_id, report_date, progress, textbook, homework_today, classnote_sent_at, classes!lesson_reports_class_id_fkey!inner(subject, math_learning_track)")
        .eq("tenant_id", tenantId).in("student_id", chunk).in("class_id", previousClassIds)
        .eq("classes.subject", "math").eq("classes.math_learning_track", track)
        .or("classnote_status.eq.success,classnote_sent_at.not.is.null,edutrix_share_token.not.is.null,source.eq.demo_history")
        .is("revoked_at", null).lte("report_date", referenceDate)
        .order("report_date").order("classnote_sent_at", { nullsFirst: true }).order("id").range(from, to),
    ) : [];
    const asRecord = (row: Row): LearningRecord => ({ date: row.report_date, progress: row.progress, textbook: row.textbook, homework: row.homework_today, sentAt: row.classnote_sent_at });
    const previousByStudent = new Map<string, LearningRecord[]>();
    for (const row of previousRecords) {
      if (!previousEnrollments.some(enrollment => enrollment.student_id === row.student_id && enrollment.class_id === row.class_id
        && (!enrollment.start_date || row.report_date >= enrollment.start_date) && row.report_date <= enrollment.end_date!)) continue;
      const list = previousByStudent.get(row.student_id) ?? [];
      list.push(asRecord(row));
      previousByStudent.set(row.student_id, list);
    }
    const byStudent = new Map<string, LearningRecord[]>();
    for (const row of records) {
      const list = byStudent.get(row.student_id) ?? [];
      list.push(asRecord(row));
      byStudent.set(row.student_id, list);
    }
    for (const studentId of visibleIds) {
      const goal = result.goals[studentId];
      const firstEnrollment = enrollments.filter(item => item.student_id === studentId && item.start_date).map(item => item.start_date!).sort()[0];
      const enrolledAt = students.find(student => student.id === studentId)?.enrolled_at ?? firstEnrollment ?? null;
      const currentRecords = (byStudent.get(studentId) ?? []).filter(record => !enrolledAt || record.date >= enrolledAt);
      const history = currentRecords.filter((record) => !goal || goal.track !== "supplement" || goal.revision || (record.date >= goal.startDate && record.date <= goal.endDate));
      if (goal) {
        result.progress[studentId] = buildLearningProgress(
          goal,
          result.context,
          currentRecords,
          referenceDate,
          monthData.month,
          { includeAfterGoal: options.forRevision },
        );
        result.progress[studentId].history = buildLearningHistory(goal, result.progress[studentId], [
          ...(previousByStudent.get(studentId) ?? []), ...(byStudent.get(studentId) ?? []),
        ], enrolledAt, referenceDate);
      }
      result.records[studentId] = (options.allRecords || options.forRevision
        ? currentRecords.filter(record => goal?.track !== "supplement" || goal.revision || options.forRevision || record.date <= goal.endDate)
        : history.slice(-30)).reverse();
    }
  } catch {
    // Do not present a report fetch failure as zero progress or a learner falling behind.
    result.status = "failed";
  }
  return result;
}
