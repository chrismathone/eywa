"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
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
 *
 * **백그라운드 패턴(0153b)** — 회의록 "AI 분석 다시 생성"(regenerateMeetingAnalysis)과 동일:
 * 액션은 ① 게이트 ② 사실 수집(빠름 + 쿠키 세션 = RLS 스코프, 액션 안에서) ③ status='generating'
 * 표시 후 **즉시 반환**하고, 병목(LLM 20~60초)은 `after()`에서 admin client로 마무리한다.
 * 화면은 진행바 + watcher(realtime+폴링)가 완료 시 자동 새로고침. 이전 브리프는 생성 중에도
 * 유지된다(재생성 실패 = 직전 브리프 증발 방지).
 *
 * provider = **DeepSeek v4-pro**(원장 지시 2026-07-29 — Sonnet 아님). 전사 분석 3종과 같은 정책:
 * 키 없으면 anthropic/upstage 무중단 폴백, 검증(grounding) 탈락 시 결정론 폴백 브리프.
 * v4-pro는 추론형이라 더 느리지만 백그라운드라 감수(전사 분석과 동일 트레이드오프).
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

  // 사실 수집은 액션 안에서(쿠키 세션 = RLS 스코프 유지 — after() 안에선 요청 컨텍스트가 없다).
  // 병렬 count 위주라 실측 ~0.5초, 버튼 반응을 안 막는다.
  const facts = await collectPrepFacts(consultationId);
  if (!facts) return { error: "상담을 찾을 수 없습니다" };

  const supabase = await createClient();
  const { error: markError } = await supabase
    .from("enrollment_consultations")
    .update({ prep_brief_status: "generating", prep_brief_error: null })
    .eq("id", consultationId);
  if (markError) {
    console.error("[prep-brief] 상태 표시 실패", markError);
    return { error: "생성 시작에 실패했습니다 — 잠시 후 다시 시도해 주세요" };
  }
  revalidatePath(`/enrollment/${consultationId}`);

  const tenantId = user.tenantId;

  // LLM 호출은 백그라운드 — 응답 종료 후라 admin client로 쓴다(id 스코프, 접근은 위 RLS 조회로
  // 이미 확인). 회의록 재분석과 동일 구조. 실패해도 진행바가 영원히 돌지 않게 반드시 status를 내린다.
  after(async () => {
    const admin = createAdminClient();
    const base = { version: 1 as const, generatedAt: new Date().toISOString(), facts };
    let record: PrepBriefRecord;
    try {
      const { data, model } = await generateJSON<unknown>({
        // deepseek 경로는 generateJSON이 추론 토큰 여유(32k 하한)로 자동 상향한다.
        maxTokens: 8192,
        provider: "deepseek",
        meta: { feature: "enrollment_prep_brief", tenantId },
        prompt: buildPrepBriefPrompt(facts),
      });
      const checked = validatePrepBrief(data, facts);
      record = checked.ok
        ? { ...base, source: "ai", model, brief: checked.value }
        : {
            ...base,
            source: "fallback",
            fallbackReason: checked.reason,
            model,
            brief: buildFallbackPrepBrief(facts),
          };
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

    const { error } = await admin
      .from("enrollment_consultations")
      .update({
        prep_brief: record,
        prep_brief_at: record.generatedAt,
        prep_brief_status: null,
        prep_brief_error: null,
      })
      .eq("id", consultationId);
    if (error) {
      console.error("[prep-brief] 저장 실패", error);
      // 저장까지 실패하면 failed로 내린다(직전 브리프는 그대로 남는다 — 화면이 재시도를 안내).
      await admin
        .from("enrollment_consultations")
        .update({ prep_brief_status: "failed", prep_brief_error: "브리프 저장에 실패했습니다" })
        .eq("id", consultationId);
    }
  });

  return { ok: true };
}
