import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { generateJSON } from "@/lib/ai/generate";
import {
  applyParentAddress,
  buildFallbackPrepBrief,
  buildPrepBriefPrompt,
  validatePrepBrief,
  type PrepBriefRecord,
  type PrepFacts,
} from "@/features/enrollment/prep-brief";
import { collectPrepFacts } from "@/features/enrollment/server/prep-facts";

/**
 * 브리프 생성 본체 — **server-only 모듈**이다("use server" 아님).
 *
 * ⚠️ 이 함수들을 서버 액션 파일에 두면 안 된다: `"use server"` 모듈의 **모든 export는 클라이언트가
 *    호출 가능한 엔드포인트**가 되어, `generatePrepBriefOnIntake(임의 상담id, 임의 tenantId)`를
 *    외부에서 그대로 부를 수 있다(권한 게이트 없는 크로스테넌트 생성). 게이트가 붙은 액션만
 *    `prep-actions.ts`에 남기고, 본체는 여기로 분리한다.
 */
/**
 * 수기 버튼과 학부모 QR 제출 자동 생성이 공유하는 실행 본체(프롬프트·검증·폴백 중복 금지).
 * 저장은 항상 admin client — after() 안에서는 요청 컨텍스트(쿠키)가 없다.
 */
export async function runPrepBriefGeneration(
  consultationId: string,
  facts: PrepFacts,
  tenantId: string,
): Promise<void> {
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
    // 호칭 후처리는 검증 **뒤**에 — 한글 이름을 호칭으로 바꾸는 치환이라 grounding(숫자·영문)에 영향 없다.
    record = checked.ok
      ? { ...base, source: "ai", model, brief: applyParentAddress(checked.value, facts) }
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
}

/**
 * 학부모 QR 접수 제출 직후 **자동 생성**(원장 지시 2026-07-29) — 상담사가 버튼을 누르러 들어오기 전에
 * 이미 상담지가 준비돼 있게 한다. 세션이 없으므로 admin client + 검증된 tenantId로 수집·저장한다.
 *
 * ⚠️ "페이지 로드로 AI 호출 금지" 규칙과 충돌하지 않는다 — 이건 렌더가 아니라 **제출 이벤트 1회**다
 *    (녹음 업로드 → 전사·분석 웹훅과 같은 모양). 재생성은 여전히 명시 버튼만.
 * 실패해도 접수 자체는 이미 저장됐으므로 조용히 로그만 남긴다(학부모 화면에 영향 없음).
 */
export async function generatePrepBriefOnIntake(consultationId: string, tenantId: string): Promise<void> {
  const admin = createAdminClient();
  try {
    const facts = await collectPrepFacts(consultationId, { client: admin, tenantId });
    if (!facts) return;
    await admin
      .from("enrollment_consultations")
      .update({ prep_brief_status: "generating", prep_brief_error: null })
      .eq("id", consultationId);
    await runPrepBriefGeneration(consultationId, facts, tenantId);
  } catch (e) {
    console.error("[prep-brief] QR 자동 생성 실패", e);
    await admin
      .from("enrollment_consultations")
      .update({ prep_brief_status: null, prep_brief_error: null })
      .eq("id", consultationId);
  }
}

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
 * 키 없으면 anthropic 무중단 폴백, 검증(grounding) 탈락 시 결정론 폴백 브리프.
 * v4-pro는 추론형이라 더 느리지만 백그라운드라 감수(전사 분석과 동일 트레이드오프).
 */
