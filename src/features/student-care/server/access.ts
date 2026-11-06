import "server-only";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant, canManageTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { visibleCareStudents } from "./student-scope";
import { createAdminClient } from "@/lib/supabase/admin";
import { CareAccessError, isCareStorageMissing } from "./errors";

/** 약속 열람·처리 문 — 실패는 `CareAccessError`(까닭: 권한 · 준비 안 됨 · 조회 실패)로 던진다(errors.ts). */
export async function careAccess(studentId?: string) {
  const user = await getCurrentUser();
  if (!user) throw new CareAccessError("로그인이 필요합니다", "denied");
  const [readAll, studentAccess, canManage, newcomerWrite, consultationWrite] = await Promise.all([
    canAccessTenant(user.systemRole, "newcomers"), canAccessTenant(user.systemRole, "students"),
    canManageTenant(user.systemRole, "newcomers"), canWriteTenant(user.systemRole, "newcomers"),
    canWriteTenant(user.systemRole, "consultations"),
  ]);
  if (!readAll && !studentAccess) throw new CareAccessError("약속을 열람할 권한이 없습니다", "denied");
  if (studentId && readAll && !(await visibleCareStudents([studentId])).has(studentId)) throw new CareAccessError("학생을 열람할 권한이 없습니다", "denied");
  if (studentId && !readAll) {
    // 반 배정 전 인계도 가능하다. 명시적으로 배정된 약속만 허용하고 학생 전체 기록 권한은 넓히지 않는다.
    const assigned = await createAdminClient().from("student_care_commitments").select("id")
      .eq("tenant_id", user.tenantId).eq("student_id", studentId).eq("owner_id", user.id).limit(1).maybeSingle();
    if (assigned.error) throw new CareAccessError(careStorageMessage(assigned.error), isCareStorageMissing(assigned.error) ? "unavailable" : "error");
    if (!assigned.data) throw new CareAccessError("약속을 열람할 권한이 없습니다", "denied");
  }
  return { user, readAll, actor: { id: user.id, canManage, canContribute: newcomerWrite || consultationWrite } };
}

export async function careStudent(studentId: string, tenantId: string) {
  const { data, error } = await createAdminClient().from("students").select("id,name,enrolled_at")
    .eq("tenant_id", tenantId).eq("id", studentId).maybeSingle();
  if (error || !data) throw new CareAccessError("학생을 확인하지 못했습니다", "error");
  return { id: String(data.id), name: String(data.name), enrolledOn: data.enrolled_at ? String(data.enrolled_at).slice(0, 10) : null };
}

/** 원문 SQL이나 내부 권한 이름은 일반 화면에 노출하지 않는다. */
export function careStorageMessage(error: { code?: string; message?: string } | null) {
  if (isCareStorageMissing(error)) return "약속 관리 저장 기능이 아직 준비되지 않았습니다. 기존 90일 체크리스트는 계속 사용할 수 있습니다.";
  if (error?.code === "40001") return "다른 변경이 있습니다. 새로 불러온 뒤 다시 시도해 주세요.";
  // 저장 함수(s2_0028·s2_0029)가 직접 던진 판정 문구(P0001 · 한글 · 원문 SQL 아님)는 그대로 — 다시 해도 안 되는 까닭을 일반 문구로 덮지 않는다(#138).
  if (error?.code === "P0001" && error.message && /[가-힣]/.test(error.message)) return error.message;
  return "약속 기록을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}
