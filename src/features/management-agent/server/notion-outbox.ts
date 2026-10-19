import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { reportError } from "@/lib/observability/report-error";
import { agentPolicy } from "../policy";
import type { AgentCase } from "../model";
import { managementNotionConfig, publishCaseNotice } from "./notion";

type Notice = { id: string; case_id: string; creation_started: boolean };
export async function flushNotionAlerts(tenantId: string): Promise<void> {
  const policy = agentPolicy((await getTenantSettingsByTenantId(tenantId)).notifications.managementAgent);
  if (policy.mode !== "active" || !policy.notionAlerts || !managementNotionConfig(tenantId)) return;
  const db = createAdminClient();
  for (let i=0; i<3; i++) {
    const claim = await db.rpc("management_notion_claim", { p_tenant: tenantId });
    if (claim.error) { reportError(claim.error, { scope: "management-agent.notion-claim" }); return; }
    const notice = (claim.data as Notice[] | null)?.[0];
    if (!notice) return;
    let started = notice.creation_started;
    try {
      const result = await db.from("management_cases").select("id,tenant_id,consultation_id,status,version")
        .eq("tenant_id", tenantId).eq("id", notice.case_id).single();
      if (result.error) throw new Error("case_unavailable");
      const row = result.data as AgentCase;
      const pageId = await publishCaseNotice(row, started, async () => {
        const saved = await db.from("management_notion_outbox").update({ creation_started: true })
          .eq("tenant_id", tenantId).eq("id", notice.id);
        if (saved.error) throw new Error("create_intent_failed");
        started = true;
      });
      const saved = await db.from("management_notion_outbox").update({ status: "sent", page_id: pageId, error_code: null, updated_at: new Date().toISOString() })
        .eq("tenant_id", tenantId).eq("case_id", row.id).lte("version", row.version);
      if (saved.error) throw new Error("delivery_save_failed");
    } catch {
      const saved = await db.from("management_notion_outbox").update({
        status: started ? "uncertain" : "failed", error_code: started ? "confirm_required" : "delivery_failed", updated_at: new Date().toISOString(),
      }).eq("tenant_id", tenantId).eq("id", notice.id);
      if (saved.error) reportError(saved.error, { scope: "management-agent.notion-save" });
      // No request payloads, tokens, counselor notes or remote error bodies in logs.
      reportError(new Error("알림 전달 확인 필요"), { scope: "management-agent.notion" });
      return;
    }
  }
}
