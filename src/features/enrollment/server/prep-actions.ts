"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { generateJSON } from "@/lib/ai/generate";
import {
  buildFallbackPrepBrief,
  buildPrepBriefPrompt,
  validatePrepBrief,
  type PrepBriefRecord,
} from "@/features/enrollment/prep-brief";
import { collectPrepFacts } from "@/features/enrollment/server/prep-facts";

export type PrepBriefState = { error?: string; ok?: boolean } | undefined;

/**
 * 사전 상담 브리프 생성(명시 트리거 전용) — 페이지 로드로는 절대 안 돈다(AI 캐싱 규칙).
 * 결과는 상담 행에 스냅샷으로 굳고, 다시 누르기 전까지 그대로 표시된다.
 *
 * 흐름: 사실 수집(결정론) → LLM 문장화 → **검증(grounding)** → 통과면 ai, 탈락·실패면 결정론 폴백.
 * ⚠️ 폴백은 "실패 숨기기"가 아니다 — `source`가 함께 저장돼 화면이 "접수 정보 기반 기본 브리프"라고
 *    정직하게 표시한다. 상담사가 빈 화면을 받는 것보다, 사실만 정리된 문서를 받는 게 낫기 때문.
 */
export async function generatePrepBrief(
  _prev: PrepBriefState,
  formData: FormData,
): Promise<PrepBriefState> {
  const consultationId = String(formData.get("consultationId") ?? "");
  if (!consultationId) return { error: "상담 ID가 누락되었습니다" };

  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "enrollment"))) {
    return { error: "등록상담 권한이 없습니다" };
  }

  const facts = await collectPrepFacts(consultationId);
  if (!facts) return { error: "상담을 찾을 수 없습니다" };

  let record: PrepBriefRecord;
  const base = {
    version: 1 as const,
    generatedAt: new Date().toISOString(),
    facts,
  };

  try {
    const { data, model } = await generateJSON<unknown>({
      // 8192 — 4096은 marginal(실측 2026-07-28: playbook·objections가 길면 JSON이 잘려 파싱 실패 → 폴백).
      maxTokens: 8192,
      // 전역 기본이 env 미설정 시 Solar로 떨어지면 상담 화법 품질이 무너진다(2026-07-13 A/B) → 명시 고정.
      provider: "anthropic",
      meta: { feature: "enrollment_prep_brief", tenantId: user.tenantId },
      prompt: buildPrepBriefPrompt(facts),
    });
    const checked = validatePrepBrief(data, facts);
    record = checked.ok
      ? { ...base, source: "ai", model, brief: checked.value }
      : { ...base, source: "fallback", fallbackReason: checked.reason, model, brief: buildFallbackPrepBrief(facts) };
    if (!checked.ok) console.warn("[prep-brief] 검증 탈락 → 폴백", checked.reason);
  } catch (e) {
    // 원문은 서버 로그로만(UI에 기술 원문 노출 금지) — 화면엔 폴백 브리프 + '기본 브리프' 표시.
    console.error("[prep-brief] AI 생성 실패", e);
    record = {
      ...base,
      source: "fallback",
      fallbackReason: "AI 호출 실패",
      model: null,
      brief: buildFallbackPrepBrief(facts),
    };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("enrollment_consultations")
    .update({ prep_brief: record, prep_brief_at: record.generatedAt })
    .eq("id", consultationId);
  if (error) {
    console.error("[prep-brief] 저장 실패", error);
    return { error: "브리프 저장에 실패했습니다 — 잠시 후 다시 시도해 주세요" };
  }

  revalidatePath(`/enrollment/${consultationId}`);
  return { ok: true };
}
