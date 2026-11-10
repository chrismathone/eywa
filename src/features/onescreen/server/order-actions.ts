"use server";

/**
 * 원스크린 학생 표시 순서 저장(3-2, 0116a) — (tenant, teacher, class) 1행 upsert.
 * ⚠️ teacher_id는 클라 입력을 신뢰하지 않고 서버에서 파생(effectiveTeacherId — 실 강사·겸직 강사뷰 단일소스).
 * RLS는 tenant-isolation만이므로 반 소유 확인(getTeachingClassIds = 담당 반 ∪ 그날 위임 반)도 여기서 강제한다.
 * 위임 반 순서도 저장한다 — 이 테이블 키가 (teacher, class)라 대체 강사의 순서는 **자기 행**에만 쌓이고
 * 원 담임의 좌석 순서를 건드리지 않는다(표 모드로 대신 마감하려면 순서 저장이 필요하다).
 */
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { effectiveTeacherId, readonlyTeacherViewError } from "@/lib/auth/view-mode";
// 담당 반 판정 단일 소스(담당 반 ∪ 그날 위임 반) — classes.teacher_id를 직접 비교하지 말 것(0173a).
import { getTeachingClassIds } from "@/features/classes/server/delegation";
import { explainDbError } from "@/lib/supabase/db-error";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SaveOrderResult = { ok: true } | { error: string };

export async function saveStudentOrder(input: {
  classId: string;
  studentIds: string[];
}): Promise<SaveOrderResult> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  // '다른 강사 뷰'(열람 전용) 차단 — 없으면 관리자가 **그 강사의 저장 순서 행**을 덮어쓴다(teacher_id=대상).
  const roError = await readonlyTeacherViewError();
  if (roError) return { error: roError };
  const teacherId = await effectiveTeacherId();
  if (!teacherId) return { error: "강사 화면에서만 학생 순서를 저장할 수 있습니다" };

  const { classId } = input;
  const studentIds = [...new Set(input.studentIds)];
  if (!UUID_RE.test(classId)) return { error: "잘못된 반입니다" };
  if (studentIds.length === 0 || studentIds.length > 200 || studentIds.some((id) => !UUID_RE.test(id)))
    return { error: "잘못된 학생 목록입니다" };

  const supabase = await createClient();
  // 담당 반 소유 확인 — 남의 반 키로 개인 설정 행을 쌓지 않게(scoped 강제). 소속 검증과 독립 조회 → 병렬(B4).
  const [teaching, { data: enrolled }] = await Promise.all([
    getTeachingClassIds(supabase, teacherId),
    supabase.from("enrollments").select("student_id").eq("class_id", classId).is("end_date", null),
  ]);
  if (!teaching.all.includes(classId)) return { error: "담당 반이 아닙니다" };

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
  if (error) return { error: explainDbError(error, { scope: "onescreen.order-actions.saveStudentOrder", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };
  return { ok: true };
}
