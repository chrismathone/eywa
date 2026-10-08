"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { kstToday } from "@/lib/date-kst";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAction } from "@/features/audit/server/log";
import { requireMcsClassAccess } from "./access";
import { getMathSheetMonth } from "./month-queries";
import { getMathLearningData } from "./learning-queries";
import { learningDays, type LearningContext, type LearningGoal, type LearningProgress } from "../lib/learning-plan";
import { reviseLearningGoal } from "../lib/learning-revision";

const loadSchema = z.object({ classId: z.string().uuid(), studentId: z.string().uuid(), startDate: z.string(), track: z.enum(["regular", "supplement"]) });
const saveSchema = loadSchema.extend({ updatedAt: z.string().min(1), expectedCurrentBlock: z.string().nullable(),
  expectedCurrentDate: z.string().nullable(), textbook: z.string().trim().max(500).nullable(),
  milestones: z.array(z.object({ studyGrade: z.string().min(1).max(60), endBlock: z.string().min(1).max(500),
    endDate: z.string(), blockCount: z.number().int().positive().max(480) })).min(1).max(100) });

export type GoalRevisionData = { goal: LearningGoal; progress: LearningProgress; context: LearningContext; today: string };

export async function loadMathLearningGoalRevision(input: z.input<typeof loadSchema>): Promise<{ ok: true; data: GoalRevisionData } | { ok: false; error: string }> {
  const parsed = loadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "수정할 목표를 확인해 주세요." };
  const gate = await requireMcsClassAccess(parsed.data.classId, { write: true });
  if (!gate.ok) return { ok: false, error: gate.error };
  const today = kstToday();
  const month = await getMathSheetMonth(parsed.data.classId, [today.slice(0, 7), parsed.data.startDate.slice(0, 7)].sort().at(-1)!);
  if (!month.ok) return { ok: false, error: month.error };
  const learning = await getMathLearningData(parsed.data.classId, month.data, { studentId: parsed.data.studentId, forRevision: true });
  const goal = learning.goals[parsed.data.studentId], progress = learning.progress[parsed.data.studentId];
  if (learning.status !== "ok" || !goal || !progress || goal.startDate !== parsed.data.startDate)
    return { ok: false, error: "현재 목표와 진도를 확인하지 못했습니다. 새로고침 후 다시 시도해 주세요." };
  if (goal.track !== parsed.data.track)
    return { ok: false, error: "반의 수업 유형이 변경되었습니다. 새로고침 후 현재 목표를 확인해 주세요." };
  if (!goal.blockCount || !goal.updatedAt)
    return { ok: false, error: "이전 방식으로 저장한 목표는 전체 목표 설정에서 새 계획으로 등록해 주세요." };
  return { ok: true, data: { goal, progress, context: learning.context, today } };
}

export async function reviseMathLearningGoal(input: z.input<typeof saveSchema>): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "목표 단원·날짜·구간별 블록 수를 확인해 주세요." };
  const value = parsed.data;
  const gate = await requireMcsClassAccess(value.classId, { write: true });
  if (!gate.ok) return { ok: false, error: gate.error };
  const loaded = await loadMathLearningGoalRevision(value);
  if (!loaded.ok) return loaded;
  const { goal: previous, progress, context, today } = loaded.data;
  if (previous.updatedAt !== value.updatedAt || progress.currentBlock !== value.expectedCurrentBlock || progress.currentDate !== value.expectedCurrentDate)
    return { ok: false, error: "목표 또는 현재 진도가 변경되었습니다. 창을 다시 열어 최신 계획을 확인해 주세요." };
  const revised = reviseLearningGoal(previous, progress, value.milestones, value.textbook, today);
  if (!revised.ok) return revised;
  const goal = revised.goal, days = learningDays(goal, context);
  if (!days.length && goal.milestones!.some(stop => stop.endDate > today))
    return { ok: false, error: "남은 목표 구간에 수업이 없습니다. 완료 예정일·시간표·수강 기간을 확인해 주세요." };
  const { tenantId, classId, user } = gate.access;
  const saved = await createAdminClient().from("math_learning_track_goals").update({
    end_study_grade: goal.endStudyGrade, end_block: goal.endBlock, end_date: goal.endDate,
    block_count: goal.blockCount, milestones: goal.milestones, textbook: goal.textbook,
    plan_revision: goal.revision, updated_by: user.id,
  }).eq("tenant_id", tenantId).eq("class_id", classId).eq("student_id", value.studentId)
    .eq("track", goal.track ?? "regular").eq("start_date", value.startDate).eq("updated_at", value.updatedAt).select("student_id");
  if (saved.error) return { ok: false, error: "남은 계획을 저장하지 못했습니다. 입력한 내용을 유지했으니 다시 시도해 주세요." };
  if (!saved.data?.length) return { ok: false, error: "다른 곳에서 목표가 변경되었습니다. 창을 다시 열어 주세요." };
  await logAction({ action: "mcs_learning_goal_revise", targetType: "class", targetLabel: gate.access.className,
    metadata: { classId, studentId: value.studentId, startDate: value.startDate, effectiveDate: today,
      previousUpdatedAt: value.updatedAt, milestones: goal.milestones, textbook: goal.textbook } });
  revalidatePath(`/mcs/${classId}/month`);
  revalidatePath("/mcs");
  return { ok: true };
}
