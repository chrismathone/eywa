"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSuperAdmin } from "@/lib/auth/super-admin";
import { isTenantModelFeature, modelChoicesFor } from "@/lib/ai/model-features";
import { logDbError } from "@/lib/supabase/db-error";
import { logSuperAdminAction } from "./audit";

export type AiModelSaveState = { ok?: boolean; error?: string; feature?: string } | undefined;

/**
 * 지점·기능별 AI 모델 고르기(운영 콘솔 'AI 모델' 탭, 0375a — 원장 2026-10-19).
 * model 빈 값 = 기본값으로(줄 삭제). 목록 밖의 기능·모델은 거절한다(기다리는 기능의 느린 모델 포함 — 화면과 같은 목록).
 * 모든 변경은 운영 감사 로그('set_ai_model')에 남는다 — 학원 이름은 서버가 읽은 값으로 적는다.
 */
export async function setTenantAiModel(_prev: AiModelSaveState, formData: FormData): Promise<AiModelSaveState> {
  const sa = await requireSuperAdmin();
  const tenantId = String(formData.get("tenantId") ?? "").trim();
  const feature = String(formData.get("feature") ?? "").trim();
  const model = String(formData.get("model") ?? "").trim();
  if (!tenantId || !feature) return { error: "필수 값이 빠졌습니다.", feature };
  if (!isTenantModelFeature(feature)) return { error: "모델을 고를 수 없는 기능입니다.", feature };
  if (model && !modelChoicesFor(feature).some((c) => c.model === model)) return { error: "이 기능에는 고를 수 없는 모델입니다.", feature };

  const admin = createAdminClient();
  const { data: tenant, error: tenantError } = await admin.from("tenants").select("name").eq("id", tenantId).maybeSingle();
  if (tenantError) {
    logDbError(tenantError, "super-admin.ai-model", { op: "tenant", feature });
    return { error: "학원 정보를 읽지 못했습니다. 잠시 후 다시 시도해 주세요.", feature };
  }
  if (!tenant) return { error: "학원을 찾지 못했습니다.", feature };

  const { error } = model
    ? await admin
        .from("tenant_ai_models")
        .upsert(
          { tenant_id: tenantId, feature, model, updated_by: sa.id, updated_at: new Date().toISOString() },
          { onConflict: "tenant_id,feature" },
        )
    : await admin.from("tenant_ai_models").delete().eq("tenant_id", tenantId).eq("feature", feature);
  if (error) {
    logDbError(error, "super-admin.ai-model", { op: model ? "upsert" : "delete", feature });
    const missing = error.code === "PGRST205" || error.code === "42P01" || /does not exist|schema cache/i.test(error.message ?? "");
    return {
      error: missing ? "DB에 AI 모델 표가 아직 없습니다 — 0375a를 먼저 적용해 주세요." : "저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      feature,
    };
  }

  await logSuperAdminAction({
    actorId: sa.id,
    actorEmail: sa.email,
    action: "set_ai_model",
    targetTenantId: tenantId,
    targetLabel: typeof tenant.name === "string" ? tenant.name : null,
    metadata: { feature, model: model || null },
  });
  revalidatePath(`/super-admin/tenants/${tenantId}`);
  return { ok: true, feature };
}
