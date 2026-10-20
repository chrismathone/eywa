import "server-only";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getUserPermMatrix } from "@/lib/auth/perm-matrix";
import { accessLevel } from "@/lib/permissions";
import { getTenantSettings } from "@/features/owner/server/queries";
import { isModuleEnabled } from "@/lib/modules";
import { viewAsTeacher } from "@/lib/auth/view-as";

export async function visitorAccess() {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return null;
  // Projection matrices may cap scoped to readonly. Never use that as academy-wide access.
  if (await viewAsTeacher()) return null;
  const [matrix, settings] = await Promise.all([getUserPermMatrix(), getTenantSettings()]);
  // Use the actual scope; a readonly teacher-view cap must not widen scoped access.
  if (!["full", "readonly"].includes(accessLevel(user.systemRole, "enrollment", matrix))
    || !isModuleEnabled(settings.modules.disabled, "calendar")) return null;
  return user;
}
