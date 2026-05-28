"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";

export type MergeStudentsState =
  | { error?: string; mergedRows?: number }
  | undefined;

/**
 * 두 학생 병합. keeperId가 살아남고, mergeeId의 데이터를 모두 keeperId로 이전.
 * 이전 대상: enrollments, attendance_records, invoices, student_consultations,
 *           student_grades, student_memos, enrollment_consultations(linked).
 * mergee는 soft delete (status='withdrawn' + withdrawn_at=today + 메모로 마킹).
 */
export async function mergeStudents(
  _prev: MergeStudentsState,
  formData: FormData,
): Promise<MergeStudentsState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };

  const keeperId = String(formData.get("keeperId") ?? "").trim();
  const mergeeId = String(formData.get("mergeeId") ?? "").trim();
  if (!keeperId || !mergeeId || keeperId === mergeeId) {
    return { error: "유효한 두 학생을 선택해주세요" };
  }

  const supabase = await createClient();
  let mergedRows = 0;

  const tables = [
    "enrollments",
    "attendance_records",
    "invoices",
    "student_consultations",
    "student_grades",
    "student_memos",
  ];
  for (const table of tables) {
    const { error, count } = await supabase
      .from(table)
      .update({ student_id: keeperId }, { count: "exact" })
      .eq("student_id", mergeeId);
    if (error) return { error: `${table}: ${error.message}` };
    mergedRows += count ?? 0;
  }

  // enrollment_consultations.linked_student_id
  await supabase
    .from("enrollment_consultations")
    .update({ student_id: keeperId })
    .eq("student_id", mergeeId);

  // mergee soft delete
  const today = new Date().toISOString().slice(0, 10);
  await supabase
    .from("students")
    .update({
      status: "withdrawn",
      withdrawn_at: today,
      notes: `중복 병합: ${keeperId}와 통합됨 (${today})`,
    })
    .eq("id", mergeeId);

  revalidatePath("/admin/duplicates");
  revalidatePath("/students");
  return { mergedRows };
}

export type SaveScenarioState = { error?: string; id?: string } | undefined;

export async function saveCurrentAsScenario(
  _prev: SaveScenarioState,
  formData: FormData,
): Promise<SaveScenarioState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };

  const name = String(formData.get("name") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim() || null;
  if (!name) return { error: "시나리오 이름을 입력해주세요" };

  const supabase = await createClient();

  // 현재 enrollments + classes + class_schedules snapshot
  const [{ data: enrollments }, { data: classes }, { data: schedules }] = await Promise.all([
    supabase
      .from("enrollments")
      .select("id, student_id, class_id, start_date, end_date, on_hold")
      .is("end_date", null),
    supabase
      .from("classes")
      .select("id, class_name, subject, teacher_id, classroom_id, is_active"),
    supabase
      .from("class_schedules")
      .select("id, class_id, day_of_week, start_time, end_time"),
  ]);

  const snapshot = {
    capturedAt: new Date().toISOString(),
    enrollments: enrollments ?? [],
    classes: classes ?? [],
    schedules: schedules ?? [],
  };

  const today = new Date();
  const period = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;

  const { data, error } = await supabase
    .from("scenarios")
    .insert({
      tenant_id: user.tenantId,
      name,
      base_period: period,
      snapshot,
      notes,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error || !data) return { error: error?.message ?? "시나리오 저장 실패" };

  revalidatePath("/admin/scenarios");
  return { id: data.id };
}

export type DeleteScenarioState = { error?: string } | undefined;

export async function deleteScenario(
  _prev: DeleteScenarioState,
  formData: FormData,
): Promise<DeleteScenarioState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "시나리오 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { error } = await supabase.from("scenarios").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/admin/scenarios");
  return undefined;
}

export type CleanupState = { error?: string; closedCount?: number } | undefined;

/** withdrawn 학생의 활성 enrollment 강제 종료. */
export async function closeOrphanEnrollments(
  _prev: CleanupState,
  _formData: FormData,
): Promise<CleanupState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };

  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data: withdrawnStudents } = await supabase
    .from("students")
    .select("id")
    .eq("status", "withdrawn");
  const ids = (withdrawnStudents ?? []).map((s) => s.id);
  if (ids.length === 0) return { closedCount: 0 };

  const { error, count } = await supabase
    .from("enrollments")
    .update(
      { end_date: today, withdrawal_reason: "퇴원에 따른 자동 종료" },
      { count: "exact" },
    )
    .in("student_id", ids)
    .is("end_date", null);

  if (error) return { error: error.message };

  revalidatePath("/admin/cleanup");
  return { closedCount: count ?? 0 };
}
