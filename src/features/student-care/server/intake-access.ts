import "server-only";
import { canAccessTenant } from "@/lib/auth/perm-matrix";
import { createAdminClient } from "@/lib/supabase/admin";
import { careAccess, careStorageMessage } from "./access";
import { CareAccessError, isCareStorageMissing } from "./errors";

/** 입학 전에는 인계된 약속만 공개한다. 상담 원문 권한은 별도로 확인한다. */
export async function intakeCareAccess(intakeId: string) {
  const base = await careAccess();
  const admin = createAdminClient();
  const readSource = await canAccessTenant(base.user.systemRole, "enrollment");
  const readAll = base.readAll && readSource;
  if (!readAll) {
    const assigned = await admin.from("student_care_commitments").select("id").eq("tenant_id", base.user.tenantId)
      .eq("intake_id", intakeId).eq("owner_id", base.user.id).limit(1).maybeSingle();
    if (assigned.error) throw new CareAccessError(careStorageMessage(assigned.error), isCareStorageMissing(assigned.error) ? "unavailable" : "error");
    if (!assigned.data) throw new CareAccessError("약속을 열람할 권한이 없습니다", "denied");
  }
  const result = await admin.from("enrollment_consultations").select("id,prospect_name,student_id")
    .eq("tenant_id", base.user.tenantId).eq("id", intakeId).maybeSingle();
  if (result.error || !result.data) throw new CareAccessError("약속을 연결할 입학상담을 확인하지 못했습니다", "error");
  const intake = { id: String(result.data.id), name: String(result.data.prospect_name ?? "상담 학생"), studentId: result.data.student_id ? String(result.data.student_id) : null };
  // 전환 뒤에도 학생 화면과 같은 담당 범위를 적용한다.
  const access = intake.studentId ? await careAccess(intake.studentId) : base;
  return { ...access, readAll: access.readAll && readAll, readSource, intake,
    actor: { ...access.actor, canManage: access.actor.canManage && readSource } };
}
