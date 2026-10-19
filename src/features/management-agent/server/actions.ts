"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { explainDbError } from "@/lib/supabase/db-error";
import { pokeSlack } from "@/features/slack/server/poke";
import { caseCommandSchema } from "../validation";
import { agentContext, missingAgentSchema } from "./access";
import { runManagementAgent } from "./worker";
import { flushNotionAlerts } from "./notion-outbox";

export type AgentActionState = { error?: string; message?: string };

export async function changeManagementCase(input: unknown): Promise<AgentActionState> {
  const parsed = caseCommandSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "입력 내용을 확인해 주세요." };
  const ctx = await agentContext(true);
  if (!ctx) return { error: "후속조치 처리 권한 또는 기능 설정을 확인해 주세요." };
  const v = parsed.data;
  const { error } = await ctx.db.rpc("management_case_command", {
    p_id: v.caseId, p_version: v.version, p_command: v.command,
    p_result: v.result, p_note: v.note, p_next: v.nextCheckOn,
  });
  if (error) return { error: missingAgentSchema(error) ? "후속조치 관리 기능을 준비 중입니다." :
    explainDbError(error, { scope: "management-agent.command", fallback: "저장하지 못했습니다. 최신 내용 확인 후 다시 시도해 주세요." }).message };
  if (ctx.policy.mode === "active") {
    pokeSlack(ctx.user.tenantId);
    after(() => flushNotionAlerts(ctx.user.tenantId));
  }
  revalidatePath("/consultations", "layout");
  revalidatePath("/dashboard");
  return { message: "처리 기록을 저장했습니다." };
}

export async function refreshManagementCases(): Promise<AgentActionState> {
  const ctx = await agentContext(true);
  if (!ctx?.manager) return { error: "관리자만 최신 상태를 확인할 수 있습니다." };
  const result = await runManagementAgent(ctx.user.tenantId);
  if (result.error) return { error: result.error };
  revalidatePath("/consultations", "layout");
  revalidatePath("/dashboard");
  return { message: "최신 상담 기록을 확인했습니다." };
}
