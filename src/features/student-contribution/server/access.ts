import "server-only";
import { cache } from "react";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";
import { viewAsTeacher } from "@/lib/auth/view-as";
import { isLaboratoryMenuAvailable } from "@/lib/laboratory/server";
import { CONTRIBUTION_PILOT_TENANT } from "../model/access";

/** 목록·상세·설정·모든 사용자 액션이 공유하는 두 열쇠. 배치에는 별도 비밀키가 필요하다. */
export const getContributionGate = cache(async () => {
  const user = await getCurrentUser({ teacherView: true });
  if (!user || user.tenantId !== CONTRIBUTION_PILOT_TENANT) return null;
  const allowed = await Promise.all([canAccessTenant(user.systemRole, "student_contribution"),
    canAccessTenant(user.systemRole, "billing"), isLaboratoryMenuAvailable(user.tenantId, "student_contribution")]);
  if (allowed.some((value) => !value)) return null;
  const owner = user.systemRole === "master" || (!(await viewAsTeacher()) && await isCurrentUserSuperAdmin());
  const canConfigure = owner;
  const canWrite = owner && await canWriteTenant(user.systemRole, "student_contribution");
  return { tenantId: user.tenantId, userId: user.id, canConfigure, canWrite };
});

export async function requireContributionWrite() {
  const gate = await getContributionGate();
  if (!gate?.canWrite) throw new Error("로열티 설정을 변경할 권한이 없습니다");
  return gate;
}
