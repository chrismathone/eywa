import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSuperAdmin } from "@/lib/auth/super-admin";
import { TENANT_MODEL_FEATURES, isTenantModelFeature, modelChoicesFor } from "@/lib/ai/model-features";

export type TenantAiModelState = {
  /** 0374a `tenant_ai_models`가 아직 없다(적용 전) — 탭은 안내만 하고 고르기를 막는다. */
  tableMissing: boolean;
  /** 기능 → 고른 모델 id(목록 안의 값만). 없는 기능 = 기본값. */
  choices: Record<string, string>;
  /** 기능 → 최근 30일 실제로 불린 마지막 모델(ai_usage_logs). 없으면 그 기간에 안 쓰임. */
  recent: Record<string, { model: string; at: string } | null>;
};

/** PostgREST가 표를 모를 때(마이그레이션 전) — 그 밖의 오류는 던져서 화면이 거짓 '기본값'을 보이지 않게. */
function isMissingTable(err: { code?: string; message?: string } | null): boolean {
  return !!err && (err.code === "PGRST205" || err.code === "42P01" || /does not exist|schema cache/i.test(err.message ?? ""));
}

/**
 * 운영 콘솔 학원 상세 'AI 모델' 탭 — 지점이 고른 모델 + 기능마다 최근 실제로 쓰인 모델.
 * 최근 모델은 기능마다 한 줄만 읽는다(세지 않는다 — 집계는 이 탭의 목적이 아니다).
 */
export const getTenantAiModels = cache(async (tenantId: string): Promise<TenantAiModelState> => {
  await requireSuperAdmin();
  const admin = createAdminClient();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [picked, ...recentRows] = await Promise.all([
    admin.from("tenant_ai_models").select("feature, model").eq("tenant_id", tenantId),
    ...TENANT_MODEL_FEATURES.map((f) =>
      admin
        .from("ai_usage_logs")
        .select("model, created_at")
        .eq("tenant_id", tenantId)
        .eq("feature", f.key)
        .eq("ok", true)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ),
  ]);
  const tableMissing = isMissingTable(picked.error);
  if (picked.error && !tableMissing) throw new Error(`getTenantAiModels: ${picked.error.message}`);
  const choices: Record<string, string> = {};
  for (const row of picked.data ?? []) {
    // 실행 조회(tenant-models.ts)와 같은 판정 — 그 기능에 고를 수 없는 값은 '기본값'으로 보인다(실제로도 기본값으로 돈다).
    if (isTenantModelFeature(row.feature) && modelChoicesFor(row.feature).some((c) => c.model === row.model)) choices[row.feature] = row.model;
  }
  const recent: TenantAiModelState["recent"] = {};
  TENANT_MODEL_FEATURES.forEach((f, i) => {
    const r = recentRows[i];
    recent[f.key] = r && !r.error && r.data ? { model: r.data.model, at: r.data.created_at } : null;
  });
  return { tableMissing, choices, recent };
});
