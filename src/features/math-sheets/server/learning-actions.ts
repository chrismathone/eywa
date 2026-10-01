"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { canResetMathLearningGoals, requireMcsClassAccess } from "./access";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildHolidayMap } from "@/features/attendance/calendar";
import { mathSpansOf } from "../lib/roster";
import {
  learningDays,
  learningGoalError,
  goalMilestones,
  normalizeLearningGoal,
  type LearningContext,
  type LearningGoal,
} from "../lib/learning-plan";
import { logAction } from "@/features/audit/server/log";
import { readMathLearningTrack } from "./learning-track";
import { logDbError } from "@/lib/supabase/db-error";

const inputSchema = z.object({
  classId: z.string().uuid(),
  studentIds: z.array(z.string().uuid()).min(1).max(100),
  studyGrade: z.string().trim().min(1).max(60),
  endStudyGrade: z.string().trim().min(1).max(60).optional(),
  startBlock: z.string().min(1).max(500),
  endBlock: z.string().min(1).max(500),
  startDate: z.string(),
  endDate: z.string(),
  textbook: z.string().trim().max(500).nullable(),
  track: z.enum(["regular", "supplement"]).default("regular"),
  blockCount: z.number().int().positive().nullable().optional(),
  milestones: z.array(z.object({
    studyGrade: z.string().min(1).max(60), endBlock: z.string().min(1).max(500),
    endDate: z.string(), blockCount: z.number().int().positive(),
  })).max(100).optional(),
  mode: z.enum(["create", "extend"]).default("create"),
  updatedAt: z.string().optional(),
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
  const classTrack = await readMathLearningTrack(tenantId, classId);
  if (!classTrack) return { ok: false, error: "반의 수업 유형을 확인하지 못했습니다. 새로고침 후 다시 시도해 주세요." };
  if (value.track !== classTrack) return { ok: false, error: "반에 지정된 수업 유형과 목표 유형이 다릅니다. 새로고침해 주세요." };
  if (value.mode === "extend") {
    if (studentIds.length !== 1 || !value.updatedAt || !value.blockCount)
      return { ok: false, error: "확장할 학생의 기존 목표를 다시 불러와 주세요." };
    const { data: existing, error } = await admin.from("math_learning_track_goals")
      .select("study_grade,end_study_grade,start_block,end_block,start_date,end_date,block_count,milestones,updated_at")
      .eq("tenant_id", tenantId).eq("class_id", classId).eq("student_id", studentIds[0])
      .eq("track", classTrack).eq("start_date", value.startDate).maybeSingle();
    if (error || !existing || existing.updated_at !== value.updatedAt)
      return { ok: false, error: "목표가 변경되었습니다. 새로고침 후 다시 확장해 주세요." };
    const oldStops = goalMilestones(normalizeLearningGoal({ studentId: studentIds[0], studyGrade: existing.study_grade,
      endStudyGrade: existing.end_study_grade ?? undefined, startBlock: existing.start_block,
      endBlock: existing.end_block, startDate: existing.start_date, endDate: existing.end_date,
      blockCount: existing.block_count, milestones: existing.milestones, textbook: null, track: classTrack }));
    const stops = value.milestones ?? [];
    const sameStop = (a: typeof oldStops[number], b: typeof oldStops[number]) => a.studyGrade === b.studyGrade && a.endBlock === b.endBlock && a.endDate === b.endDate && a.blockCount === b.blockCount;
    if (value.studyGrade !== existing.study_grade || value.startBlock !== existing.start_block || stops.length !== oldStops.length + 1 || oldStops.some((stop, i) => !sameStop(stop, stops[i])))
      return { ok: false, error: "이전 목표 정거장은 유지하고 다음 목표를 추가해 주세요." };
  }
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
  if (value.track === "supplement" && (!value.blockCount || value.blockCount % 4 !== 0))
    return { ok: false, error: "복습 심화 목표는 월 4블록으로 설정해 주세요." };
  const standard = value.blockCount != null;
  const rows = studentIds.map((studentId) => ({
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
      ...(standard ? { track: value.track, block_count: value.blockCount, end_study_grade: value.endStudyGrade ?? value.studyGrade, milestones: value.milestones ?? [] } : {}),
    }));
  const saved = value.mode === "extend"
    ? await admin.from("math_learning_track_goals").update(rows[0])
        .eq("tenant_id", tenantId).eq("class_id", classId).eq("student_id", studentIds[0])
        .eq("track", value.track).eq("start_date", value.startDate).eq("updated_at", value.updatedAt!).select("student_id")
    : standard
      ? await admin.from("math_learning_track_goals").insert(rows)
      : await admin.from("math_learning_goals").upsert(rows, { onConflict: "tenant_id,class_id,student_id" });
  const { error } = saved;
  if (error)
    return {
      ok: false,
      error: error.code === "23505"
        ? "이미 목표가 설정되었습니다. 새로고침 후 목표 확장으로 다음 정거장을 추가해 주세요."
        : ["42P01", "PGRST205"].includes(error.code)
        ? "전체 목표 저장 기능을 아직 사용할 수 없습니다. 관리자에게 알려 주세요."
        : "전체 목표를 저장하지 못했습니다. 입력한 내용을 유지했으니 다시 시도해 주세요.",
    };
  if (value.mode === "extend" && !saved.data?.length)
    return { ok: false, error: "다른 곳에서 목표가 변경되었습니다. 새로고침 후 다시 시도해 주세요." };
  await logAction({
    action: "mcs_learning_goal_save",
    targetType: "class",
    targetLabel: gate.access.className,
    metadata: {
      classId,
      studentIds,
      studyGrade: value.studyGrade,
      endStudyGrade: value.endStudyGrade,
      milestones: value.milestones,
      startBlock: value.startBlock,
      endBlock: value.endBlock,
      startDate: value.startDate,
      endDate: value.endDate,
      textbook: value.textbook,
      track: value.track,
      blockCount: value.blockCount ?? null,
    },
  });
  revalidatePath(`/mcs/${classId}/month`);
  revalidatePath("/mcs");
  return { ok: true };
}

export async function setMathClassLearningTrack(input: { classId: string; track: "regular" | "supplement" }): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = z.object({ classId: z.string().uuid(), track: z.enum(["regular", "supplement"]) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "수업 유형을 확인해 주세요." };
  const gate = await requireMcsClassAccess(parsed.data.classId, { write: true });
  if (!gate.ok) return { ok: false, error: gate.error };
  const { error, data } = await createAdminClient().from("classes").update({ math_learning_track: parsed.data.track })
    .eq("tenant_id", gate.access.tenantId).eq("id", gate.access.classId).select("id");
  if (error || !data?.length) {
    logDbError(error, "math-sheets.setMathClassLearningTrack");
    return { ok: false, error: "수업 유형을 저장하지 못했습니다. 다시 시도해 주세요." };
  }
  await logAction({ action: "mcs_class_learning_track", targetType: "class", targetLabel: gate.access.className, metadata: parsed.data });
  revalidatePath(`/mcs/${gate.access.classId}/month`);
  revalidatePath("/mcs");
  return { ok: true };
}

const resetSchema = z.object({
  classId: z.string().uuid(),
  studentIds: z.array(z.string().uuid()).min(1).max(100),
  track: z.enum(["regular", "supplement"]).default("regular"),
  /** 지울 계획의 시작일(`YYYY-MM-01`). 표준 계획은 이 날짜까지 맞아야 한 칸만 지운다. */
  startDate: z.string(),
  /** 표준 학습 계획인가 — 저장과 같은 갈래로 표를 고른다(아니면 옛 `math_learning_goals`). */
  standard: z.boolean().default(true),
});

/**
 * 전체 목표 **초기화(배정 취소)** — 원장 2026-09-18 *"초기화 기능도 추가. 배정 취소하고 싶을때."*
 *
 * 🔴 권한은 저장보다 좁다(**원장 이상급**, `canResetMathLearningGoals`) — 행을 지우는 일이라
 *    담임이 반 전체 목표를 한 번에 날릴 수 있으면 안 된다. 화면 버튼과 **같은 함수**를 서버가 다시 본다([[#77]]).
 * 🔴 지우는 범위는 **저장이 쓰는 그 한 칸**이다(같은 반·같은 학생·같은 구분·같은 시작월) — 표를 통째로 비우지 않는다.
 *    그래서 다른 달·다른 구분(복습 심화)의 계획은 남는다.
 * ⚠️ 표준 계획을 지워도 옛 `math_learning_goals`의 목표가 있으면 **그 목표가 다시 보인다**(읽기 폴백) —
 *    그건 되살아난 게 아니라 원래 있던 이전 목표다.
 */
export async function resetMathLearningGoals(
  input: z.input<typeof resetSchema>,
): Promise<{ ok: true; removed: number } | { ok: false; error: string }> {
  const parsed = resetSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "초기화할 대상을 확인해 주세요." };
  const value = parsed.data,
    studentIds = [...new Set(value.studentIds)];
  const gate = await requireMcsClassAccess(value.classId, { write: true });
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!(await canResetMathLearningGoals(gate.access.user)))
    return { ok: false, error: "전체 목표 초기화는 원장만 할 수 있습니다." };
  const admin = createAdminClient(),
    { tenantId, classId } = gate.access;
  const missing = (code?: string) => ["42P01", "PGRST205"].includes(code ?? "");
  /**
   * 🔴 **두 표를 함께 지운다** — 표준 계획만 지우면 옛 `math_learning_goals`의 목표가 읽기 폴백으로
   *    **곧바로 다시 뜬다**(화면상 "초기화가 안 됐다"). 사람이 말한 '배정 취소'는 그 학생에게 목표가
   *    없는 상태다.
   * 🔴 표준 계획은 (구분 · 시작월)까지 맞춰 **그 한 칸만** 지운다(다른 달·복습 심화 계획은 남는다).
   * 🔴 옛 표엔 구분 칸이 없어 **정규 초기화일 때만** 건드린다 — 복습 심화을 지우며 정규 목표를 날리면 안 된다.
   */
  const standardDelete = value.standard
    ? await admin
        .from("math_learning_track_goals")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("class_id", classId)
        .in("student_id", studentIds)
        .eq("track", value.track)
        .eq("start_date", value.startDate)
        .select("student_id")
    : { data: [], error: null };
  const legacyDelete =
    value.track === "regular"
      ? await admin
          .from("math_learning_goals")
          .delete()
          .eq("tenant_id", tenantId)
          .eq("class_id", classId)
          .in("student_id", studentIds)
          .select("student_id")
      : { data: [], error: null };
  // 표가 아직 없는 환경은 **실패가 아니다**([[#95]]) — 다른 한쪽만 지우고 넘어간다.
  const realError = [standardDelete.error, legacyDelete.error].find((e) => e && !missing(e.code));
  if (realError)
    return { ok: false, error: "전체 목표를 초기화하지 못했습니다. 다시 시도해 주세요." };
  const data = [...(standardDelete.data ?? []), ...(legacyDelete.data ?? [])];
  if (!data.length)
    return { ok: false, error: "초기화할 전체 목표가 없습니다." };
  await logAction({
    action: "mcs_learning_goal_reset",
    targetType: "class",
    targetLabel: gate.access.className,
    metadata: {
      classId,
      studentIds,
      track: value.track,
      startDate: value.startDate,
      standard: value.standard,
      removed: data.length,
    },
  });
  revalidatePath(`/mcs/${classId}/month`);
  revalidatePath("/mcs");
  return { ok: true, removed: data.length };
}
