"use server";

/**
 * 원스크린 학생 표시 순서 저장(3-2, 0116a) — (tenant, teacher, class) 1행 upsert.
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
  // 담당 반 소유 확인 — 남의 반 키로 개인 설정 행을 쌓지 않게(scoped 강제). 소속 검증과 독립 조회 → 병렬(B4).
  const [{ data: cls }, { data: enrolled }] = await Promise.all([
    supabase.from("classes").select("id").eq("id", classId).eq("teacher_id", teacherId).maybeSingle(),
    supabase.from("enrollments").select("student_id").eq("class_id", classId).is("end_date", null),
  ]);
  if (!cls) return { error: "담당 반이 아닙니다" };

  // ⚠️ 반 소속 검증(리뷰 확정 결함 방어): stale 순서 모드가 다른 반 학생 ids를 이 반 키로 저장해
  // 기존 저장 순서를 조용히 파괴하는 사고 차단. 이 반 유효 수강생만 저장(보강 등 비소속 id는 조용히 제외).
  const enrolledSet = new Set((enrolled ?? []).map((r) => r.student_id as string));
  const ownIds = studentIds.filter((id) => enrolledSet.has(id));
  if (ownIds.length === 0) return { error: "이 반 학생이 없습니다 — 화면을 새로고침한 뒤 다시 시도해 주세요" };

  const { error } = await supabase.from("onescreen_student_order").upsert(
    {
      tenant_id: user.tenantId,
      teacher_id: teacherId,
      class_id: classId,
      student_ids: ownIds,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,teacher_id,class_id" },
  );
  if (error) return { error: error.message };
  return { ok: true };
}
