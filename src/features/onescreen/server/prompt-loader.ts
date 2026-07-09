import type { SupabaseClient } from "@supabase/supabase-js";
import type { PromptType } from "../prompt-defaults";

/**
 * 활성 프롬프트 오버라이드 로드 — (tenant, type) is_active 1건. 없으면 null(호출부가 DEFAULT_PROMPTS 사용).
 * 조회 실패(테이블 미적용·권한 등)도 null 반환 → 기본 프롬프트로 폴백(멘트 생성이 막히지 않게).
 * server-only 미표기(supabase 클라이언트를 인자로 받는 헬퍼) — generateReportComment/Trend가 재사용.
 */
export async function loadActivePrompt(
  supabase: SupabaseClient,
  tenantId: string,
  type: PromptType,
): Promise<string | null> {
  try {
    const { data } = await supabase
      .from("ai_prompt_overrides")
      .select("prompt_text")
      .eq("tenant_id", tenantId)
      .eq("prompt_type", type)
      .eq("is_active", true)
      .maybeSingle();
    const text = (data?.prompt_text as string | null)?.trim();
    return text ? text : null;
  } catch {
    return null;
  }
}
