import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPagedInChunks } from "@/lib/supabase/batch";
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

export async function getMathLearningData(
  classId: string,
  monthData: MathSheetMonthData,
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
    .select("student_id, study_grade, end_study_grade, start_block, end_block, start_date, end_date, textbook, track, block_count, milestones, updated_at")
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
  const visibleIds = new Set(monthData.students.map((s) => s.studentId));
  for (const row of [...(legacy.data ?? []).map((row) => ({ ...row, track: "regular", block_count: null as number | null, end_study_grade: null, milestones: [], updated_at: undefined })), ...(standard.data ?? [])]) {
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
    };
    result.goals[goal.studentId] = normalizeLearningGoal(goal);
  }
  const goals = Object.values(result.goals);
  if (!goals.length) return result;
  const firstDate = goals.reduce(
    (date, goal) => (goal.startDate < date ? goal.startDate : date),
    referenceDate,
  );
  type Row = {
    student_id: string;
    report_date: string;
    progress: string | null;
    textbook: string | null;
    homework_today: string | null;
  };
  try {
    const records = await fetchAllPagedInChunks<Row>(
      [...new Set(goals.map((g) => g.studentId))],
      (chunk, from, to) =>
        admin
          .from("lesson_reports")
          .select("student_id, report_date, progress, textbook, homework_today")
          .eq("tenant_id", tenantId)
          .eq("class_id", classId)
          .in("student_id", chunk)
          .gte("report_date", firstDate)
          .lte("report_date", referenceDate)
          .order("report_date")
          .order("id")
          .range(from, to),
    );
    const byStudent = new Map<string, LearningRecord[]>();
    for (const row of records) {
      const list = byStudent.get(row.student_id) ?? [];
      list.push({
        date: row.report_date,
        progress: row.progress,
        textbook: row.textbook,
        homework: row.homework_today,
      });
      byStudent.set(row.student_id, list);
    }
    for (const goal of goals) {
      const history = (byStudent.get(goal.studentId) ?? []).filter((record) => record.date >= goal.startDate && (goal.track !== "supplement" || record.date <= goal.endDate));
      result.progress[goal.studentId] = buildLearningProgress(
        goal,
        result.context,
        history,
        referenceDate,
        monthData.month,
      );
      result.records[goal.studentId] = history.slice(-30).reverse();
    }
  } catch {
    // Do not present a report fetch failure as zero progress or a learner falling behind.
    result.status = "failed";
  }
  return result;
}
