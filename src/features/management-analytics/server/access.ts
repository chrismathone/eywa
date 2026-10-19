import "server-only";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant } from "@/lib/auth/perm-matrix";

/** Shared by the billing tab and upload API; delegated billing access cannot promote a role. */
export async function analyticsAccess() {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { ok: false as const, status: 401 as const };
  if (user.tenantView || !user.tenantId || !["master", "admin"].includes(user.systemRole) ||
    !(await canAccessTenant(user.systemRole, "billing"))) return { ok: false as const, status: 403 as const };
  return { ok: true as const, user };
}
