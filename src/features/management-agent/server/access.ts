import "server-only";
import { getCurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { getTenantSettings } from "@/features/owner/server/queries";
import { agentPolicy } from "../policy";

export async function agentContext(write = false) {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return null;
  const level = await accessLevelTenant(user.systemRole, "consultations");
  if (level === "none" || (write && level !== "full" && level !== "scoped")) return null;
  const policy = agentPolicy((await getTenantSettings()).notifications.managementAgent);
  if (policy.mode === "off") return null;
  return { user, level, policy, db: await createClient(), manager: level === "full" };
}

export function missingAgentSchema(error: { code?: string } | null): boolean {
  return !!error && ["42P01", "42883", "PGRST202", "PGRST205"].includes(error.code ?? "");
}
