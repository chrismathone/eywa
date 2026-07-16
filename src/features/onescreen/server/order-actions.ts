"use server";

/**
 * 원스크린 학생 표시 순서 저장(3-2, 0114a) — (tenant, teacher, class) 1행 upsert.
 * ⚠️ teacher_id는 클라 입력을 신뢰하지 않고 서버에서 파생(effectiveTeacherId — 실 강사·겸직 강사뷰 단일소스).
 * RLS는 tenant-isolation만이므로 담당 반 소유 확인(classes.teacher_id)도 여기서 강제한다.
 */
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { effectiveTeacherId } from "@/lib/auth/view-mode";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SaveOrderResult = { ok: true } | { error: string };

export async function saveStudentOrder(input: {
  classId: string;
  studentIds: string[];
}): Promise<SaveOrderResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  const teacherId = await effectiveTeacherId();
  if (!teacherId) return { error: "강사 화면에서만 학생 순서를 저장할 수 있습니다" };

  const { classId } = input;
  const studentIds = [...new Set(input.studentIds)];
  if (!UUID_RE.test(classId)) return { error: "잘못된 반입니다" };
  if (studentIds.length === 0 || studentIds.length > 200 || studentIds.some((id) => !UUID_RE.test(id)))
    return { error: "잘못된 학생 목록입니다" };

  const supabase = await createClient();
  // 담당 반 소유 확인 — 남의 반 키로 개인 설정 행을 쌓지 않게(scoped 강제).
  const { data: cls } = await supabase
    .from("classes")
    .select("id")
    .eq("id", classId)
    .eq("teacher_id", teacherId)
    .maybeSingle();
  if (!cls) return { error: "담당 반이 아닙니다" };

  const { error } = await supabase.from("onescreen_student_order").upsert(
    {
      tenant_id: user.tenantId,
      teacher_id: teacherId,
      class_id: classId,
      student_ids: studentIds,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,teacher_id,class_id" },
  );
  if (error) return { error: error.message };
  return { ok: true };
}
