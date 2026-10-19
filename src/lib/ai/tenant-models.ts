import "server-only";
import { cache } from "react";
import { modelFeatureOf } from "./model-pins";
import { isTenantModelFeature, modelChoicesFor } from "./model-features";

/**
 * 지점·기능별 AI 모델 선택 조회(운영 콘솔 'AI 모델' 탭, 0375a `tenant_ai_models`).
 * service_role로 읽는다 — 웹훅·cron처럼 로그인 세션이 없는 경로도 같은 함수를 쓰기 때문(라이선스 조회와 같은 이유).
 *
 * 🔴 **실패하면 선택이 없는 것으로** 본다(코드 기본 모델) — 표가 아직 없거나(마이그레이션 전, #95) 조회가 실패해도
 *    AI 기능이 멈추면 안 된다. 그래서 오류를 던지지 않고 로그도 남기지 않는다(모든 AI 호출마다 같은 오류가 쌓인다).
 * 고를 수 없는 기능(계약서 스캔 인식 · Jev 비교)은 표에 값이 있어도 무시한다.
 */
export const tenantModelChoice = cache(async (tenantId: string, feature: string): Promise<string | null> => {
  const key = modelFeatureOf(feature);
  if (!tenantId || !key || !isTenantModelFeature(key)) return null;
  try {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const { data, error } = await createAdminClient()
      .from("tenant_ai_models")
      .select("model")
      .eq("tenant_id", tenantId)
      .eq("feature", key)
      .maybeSingle();
    if (error || !data) return null;
    // 이 기능에 고를 수 없는 모델(SQL로 직접 넣은 멘트 v4-pro 등)은 없는 것으로 — 화면·저장 검증과 같은 목록.
    const model = typeof data.model === "string" ? data.model : null;
    return model && modelChoicesFor(key).some((c) => c.model === model) ? model : null;
  } catch {
    return null;
  }
});
