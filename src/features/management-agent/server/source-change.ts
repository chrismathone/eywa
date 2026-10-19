import "server-only";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { agentPolicy } from "../policy";
import { reportError } from "@/lib/observability/report-error";
import { pokeSlack } from "@/features/slack/server/poke";
import { flushNotionAlerts } from "./notion-outbox";

/** Called only after an authorized source save. A reconciliation failure never undoes the saved consultation. */
export async function syncManagementSource(tenantId: string, consultationId: string) {
  try {
    const policy = agentPolicy((await getTenantSettingsByTenantId(tenantId)).notifications.managementAgent);
    if (policy.mode === "off") return;
    const { error } = await createAdminClient().rpc("management_agent_scan", { p_tenant: tenantId, p_consultation: consultationId });
    if (error) throw error;
    revalidatePath(`/consultations/${consultationId}`);
    revalidatePath("/dashboard");
    if (policy.mode === "active") { pokeSlack(tenantId); after(() => flushNotionAlerts(tenantId)); }
  } catch { reportError(new Error("상담 저장 후 후속조치 재확인 필요"), { scope: "management-agent.source" }); }
}
