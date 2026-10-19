"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { generateJSON } from "@/lib/ai/generate";
import { agentContext } from "./access";
import { CASE_COLUMNS } from "./queries";
import { advicePrompt, adviceSchema } from "../advice";
import type { AgentCase } from "../model";
import type { AgentActionState } from "./actions";

export async function generateManagementAdvice(id: string): Promise<AgentActionState> {
  if (!z.string().uuid().safeParse(id).success) return { error: "처리할 건을 확인해 주세요." };
  const ctx = await agentContext(true);
  if (!ctx) return { error: "대응안을 작성할 권한이 없습니다." };
  const read = await ctx.db.from("management_cases").select(CASE_COLUMNS).eq("tenant_id", ctx.user.tenantId).eq("id", id).maybeSingle();
  if (read.error || !read.data) return { error: "후속조치 기록을 확인하지 못했습니다." };
  const row = read.data as AgentCase;
  if (row.ai_advice && row.ai_version === row.version) return { message: "현재 기록에 대한 대응안이 이미 있습니다." };
  if (row.status === "blocked") return { error: "상담 원본부터 확인해 주세요." };
  try {
    const generated = await generateJSON({ prompt: advicePrompt(row), maxTokens: 2048, keyName: "consultations",
      meta: { feature: "management_followup_advice", tenantId: ctx.user.tenantId } });
    const parsed = adviceSchema.safeParse(generated.data);
    if (!parsed.success) return { error: "대응안 형식을 확인하지 못했습니다. 다시 시도해 주세요." };
    const saved = await ctx.db.rpc("management_case_save_advice", { p_id: row.id, p_version: row.version, p_advice: parsed.data });
    if (saved.error) return { error: "작성 중 기록이 바뀌었거나 저장하지 못했습니다. 최신 상태를 확인해 주세요." };
    revalidatePath("/consultations", "layout");
    return { message: "검토용 대응안을 작성했습니다." };
  } catch {
    return { error: "AI 대응안을 작성하지 못했습니다. 기존 처리 기능은 계속 사용할 수 있습니다." };
  }
}
