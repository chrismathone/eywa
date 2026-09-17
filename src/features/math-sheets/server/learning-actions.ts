"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireMcsClassAccess } from "./access";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildHolidayMap } from "@/features/attendance/calendar";
import { mathSpansOf } from "../lib/roster";
import {
  learningDays,
  learningGoalError,
  type LearningContext,
  type LearningGoal,
} from "../lib/learning-plan";
import { logAction } from "@/features/audit/server/log";

const inputSchema = z.object({
  classId: z.string().uuid(),
  studentIds: z.array(z.string().uuid()).min(1).max(100),
  studyGrade: z.string().trim().min(1).max(60),
  startBlock: z.string().min(1).max(500),
  endBlock: z.string().min(1).max(500),
  startDate: z.string(),
  endDate: z.string(),
  textbook: z.string().trim().max(500).nullable(),
});

export async function saveMathLearningGoals(
  input: z.input<typeof inputSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: "학생과 전체 목표 입력값을 확인해 주세요." };
  const value = parsed.data,
    studentIds = [...new Set(value.studentIds)];
  const gate = await requireMcsClassAccess(value.classId, { write: true });
  if (!gate.ok) return { ok: false, error: gate.error };
  const base: LearningGoal = {
    ...value,
    studentId: studentIds[0]!,
    textbook: value.textbook || null,
  };
  const invalid = learningGoalError(base);
  if (invalid) return { ok: false, error: invalid };
  const admin = createAdminClient(),
    { tenantId, classId, user } = gate.access;
  const [schedules, enrollments, students, settings] = await Promise.all([
    admin
      .from("class_schedules")
      .select("day_of_week,start_time,end_time,valid_from,valid_to")
      .eq("tenant_id", tenantId)
      .eq("class_id", classId),
    admin
      .from("enrollments")
      .select("student_id,start_date,end_date,is_transferred,attendance_days")
      .eq("tenant_id", tenantId)
      .eq("class_id", classId)
      .in("student_id", studentIds),
    admin
      .from("students")
      .select("id,withdrawn_at")
      .eq("tenant_id", tenantId)
      .in("id", studentIds),
    getTenantSettings(),
  ]);
  if (schedules.error || enrollments.error || students.error)
    return {
      ok: false,
      error: "수강 명단과 시간표를 확인하지 못했습니다. 다시 시도해 주세요.",
    };
  const context: LearningContext = {
    schedules: (schedules.data ?? []).map((r) => ({
      dayOfWeek: r.day_of_week,
      startTime: r.start_time,
      endTime: r.end_time,
      validFrom: r.valid_from,
      validTo: r.valid_to,
    })),
    holidays: buildHolidayMap(settings.operations.holidays),
    spans: {},
  };
  for (const studentId of studentIds) {
    const student = students.data?.find((s) => s.id === studentId);
    const windows = (enrollments.data ?? []).filter(
      (e) => e.student_id === studentId,
    );
    if (!student || !windows.length)
      return {
        ok: false,
        error: "이 반의 수강 학생에게만 목표를 설정할 수 있습니다.",
      };
    context.spans[studentId] = windows.flatMap((e) =>
      mathSpansOf(
        [
          {
            startDate: e.start_date,
            endDate: e.end_date,
            isTransferred: e.is_transferred === true,
          },
        ],
        student.withdrawn_at,
      ).map((span) => ({ ...span, attendanceDays: e.attendance_days ?? null })),
    );
    if (!learningDays({ ...base, studentId }, context).length)
      return {
        ok: false,
        error:
          "선택한 학생의 목표 기간에 수업이 없습니다. 기간과 시간표를 확인해 주세요.",
      };
  }
  const { error } = await admin.from("math_learning_goals").upsert(
    studentIds.map((studentId) => ({
      tenant_id: tenantId,
      class_id: classId,
      student_id: studentId,
      study_grade: value.studyGrade,
      start_block: value.startBlock,
      end_block: value.endBlock,
      start_date: value.startDate,
      end_date: value.endDate,
      textbook: value.textbook || null,
      updated_by: user.id,
    })),
    { onConflict: "tenant_id,class_id,student_id" },
  );
  if (error)
    return {
      ok: false,
      error: ["42P01", "PGRST205"].includes(error.code)
        ? "전체 목표 저장 기능을 아직 사용할 수 없습니다. 관리자에게 알려 주세요."
        : "전체 목표를 저장하지 못했습니다. 입력한 내용을 유지했으니 다시 시도해 주세요.",
    };
  await logAction({
    action: "mcs_learning_goal_save",
    targetType: "class",
    targetLabel: gate.access.className,
    metadata: {
      classId,
      studentIds,
      studyGrade: value.studyGrade,
      startBlock: value.startBlock,
      endBlock: value.endBlock,
      startDate: value.startDate,
      endDate: value.endDate,
      textbook: value.textbook,
    },
  });
  revalidatePath(`/mcs/${classId}/month`);
  revalidatePath("/mcs");
  return { ok: true };
}
