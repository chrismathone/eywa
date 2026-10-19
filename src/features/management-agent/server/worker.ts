import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { reportError } from "@/lib/observability/report-error";
import { pokeSlack } from "@/features/slack/server/poke";
import { agentPolicy } from "../policy";
import { missingAgentSchema } from "./access";
import { flushNotionAlerts } from "./notion-outbox";

export async function runManagementAgent(tenantId: string) {
  const policy = agentPolicy((await getTenantSettingsByTenantId(tenantId)).notifications.managementAgent);
  if (policy.mode === "off") return { active: false, changed: 0 };
  const { data, error } = await createAdminClient().rpc("management_agent_scan", { p_tenant: tenantId });
  if (error) {
    if (!missingAgentSchema(error)) reportError(error, { scope: "management-agent.scan" });
    return { active: false, changed: 0, error: "후속조치 상태를 확인하지 못했습니다. 기능 준비 상태를 확인해 주세요." };
  }
  if (policy.mode === "active") {
    pokeSlack(tenantId);
    await flushNotionAlerts(tenantId);
  }
  return { active: policy.mode === "active", changed: Number(data ?? 0) };
}
