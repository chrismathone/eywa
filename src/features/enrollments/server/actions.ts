"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";

export type CreateEnrollmentState =
  | { error?: string; enrollmentId?: string }
  | undefined;

/**
 * 학생을 반에 배정.
 * - GiST EXCLUDE 제약으로 학생의 다른 enrollment와 시간 겹침은 자동 차단됨.
 * - UI 단에서 미리 detectStudentScheduleConflicts로 경고할 수 있음.
 */
export async function createEnrollment(
  _prev: CreateEnrollmentState,
  formData: FormData,
): Promise<CreateEnrollmentState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };

  const studentId = String(formData.get("studentId") ?? "").trim();
  const classId = String(formData.get("classId") ?? "").trim();
  const startDate =
    String(formData.get("startDate") ?? "").trim() || new Date().toISOString().slice(0, 10);
  const endDate = String(formData.get("endDate") ?? "").trim() || null;

  if (!studentId) return { error: "학생을 선택해주세요" };
  if (!classId) return { error: "반을 선택해주세요" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("enrollments")
    .insert({
      tenant_id: user.tenantId,
      student_id: studentId,
      class_id: classId,
      start_date: startDate,
      end_date: endDate,
    })
    .select("id")
    .single();

  if (error || !data) {
    if (error?.message?.includes("conflicting_period")) {
      return { error: "이 학생이 같은 시간대 다른 반에 이미 배정되어 있습니다" };
    }
    return { error: error?.message ?? "수강 배정 실패" };
  }

  revalidatePath("/timetable");
  revalidatePath(`/students/${studentId}`);
  revalidatePath(`/classes/${classId}`);
  return { enrollmentId: data.id };
}

export type EndEnrollmentState = { error?: string } | undefined;

export async function endEnrollment(
  _prev: EndEnrollmentState,
  formData: FormData,
): Promise<EndEnrollmentState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };

  const id = String(formData.get("id") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim() || "수강 종료";
  const endDate =
    String(formData.get("endDate") ?? "").trim() || new Date().toISOString().slice(0, 10);

  if (!id) return { error: "수강 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("enrollments")
    .update({ end_date: endDate, withdrawal_reason: reason })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/timetable");
  revalidatePath("/students");
  return undefined;
}

export type MoveEnrollmentState = { error?: string } | undefined;

/**
 * 학생을 한 반에서 다른 반으로 이동.
 * 기존 enrollment 종료 + 새 enrollment 생성 (transactional 흐름).
 */
export async function moveEnrollment(
  _prev: MoveEnrollmentState,
  formData: FormData,
): Promise<MoveEnrollmentState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };

  const enrollmentId = String(formData.get("enrollmentId") ?? "").trim();
  const newClassId = String(formData.get("newClassId") ?? "").trim();
  const startDate =
    String(formData.get("startDate") ?? "").trim() || new Date().toISOString().slice(0, 10);

  if (!enrollmentId) return { error: "수강 ID가 누락되었습니다" };
  if (!newClassId) return { error: "이동할 반을 선택해주세요" };

  const supabase = await createClient();
  const { data: current } = await supabase
    .from("enrollments")
    .select("student_id, end_date")
    .eq("id", enrollmentId)
    .single();
  if (!current) return { error: "기존 수강 정보를 찾을 수 없습니다" };

  // 1) 기존 enrollment 종료
  const today = new Date().toISOString().slice(0, 10);
  const { error: endErr } = await supabase
    .from("enrollments")
    .update({ end_date: today, withdrawal_reason: "반 이동" })
    .eq("id", enrollmentId);
  if (endErr) return { error: endErr.message };

  // 2) 새 enrollment INSERT
  const { error: newErr } = await supabase.from("enrollments").insert({
    tenant_id: user.tenantId,
    student_id: current.student_id,
    class_id: newClassId,
    start_date: startDate,
  });

  if (newErr) {
    // 새 enrollment 실패 - 기존 복구 시도
    await supabase
      .from("enrollments")
      .update({ end_date: current.end_date, withdrawal_reason: null })
      .eq("id", enrollmentId);
    if (newErr.message?.includes("conflicting_period")) {
      return { error: "학생이 같은 시간대 다른 반에 이미 배정되어 있습니다" };
    }
    return { error: newErr.message };
  }

  revalidatePath("/timetable");
  return undefined;
}

export type BatchMoveInput = {
  enrollmentId: string;
  newClassId: string;
  startDate?: string;
};
export type BatchMoveResult = {
  enrollmentId: string;
  ok: boolean;
  error?: string;
};
export type MoveEnrollmentsBatchState = {
  error?: string;
  results?: BatchMoveResult[];
};

/**
 * 편집 모드 '저장' — 보류 이동들을 한 번에 커밋. 압축은 클라(compressMoves)에서 끝낸 결과를 받는다.
 * move_enrollments_batch RPC(SECURITY INVOKER + per-move 서브트랜잭션)로 RLS 유지 + 원자성 확보.
 * 1건이 GiST 시간겹침 등으로 실패해도 나머지는 커밋되고, 실패 목록을 results로 돌려준다.
 */
export async function moveEnrollmentsBatch(
  moves: BatchMoveInput[],
): Promise<MoveEnrollmentsBatchState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!Array.isArray(moves) || moves.length === 0) return { results: [] };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("move_enrollments_batch", {
    p_moves: moves.map((m) => ({
      enrollmentId: m.enrollmentId,
      newClassId: m.newClassId,
      startDate: m.startDate ?? null,
    })),
  });

  if (error) return { error: error.message };

  const results = (data ?? []) as BatchMoveResult[];
  revalidatePath("/timetable");
  return { results };
}
