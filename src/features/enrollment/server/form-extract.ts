import "server-only";
import { generateJSON } from "@/lib/ai/generate";
import type { AiKeyName, AiProvider } from "@/lib/ai/models";
import type { ExtractedConsultationForm } from "../form-fill";
import { normalizeExtractedForm } from "../form-normalize";
import { buildConsultationFormPrompt, type ConsultationFormPromptContext } from "../form-extract-prompt";

export type ExtractContext = ConsultationFormPromptContext & {
  /**
   * usage 귀속 전용(`ai_usage_logs.tenant_id`) — 프롬프트엔 안 들어간다. 지점이 둘 이상이면 비용을 지점별로 가르는 유일한 단서.
   * 🔴 **필수**다(모르면 null을 **명시**) — optional로 두면 새 호출부가 빼먹어도 컴파일·가드가 둘 다 초록인 채 빈칸이 쌓인다
   *    (가드는 generateJSON의 meta에 속성이 **있는지**만 본다 · 적대 리뷰 2026-09-21).
   */
  /** 지점 — AI 라이선스·사용량 귀속. 필수(없으면 generateJSON이 거절한다). */
  tenantId: string;
};

/**
 * 등록상담 전사 → 폼 필드 구조화 추출(ijw processRegistrationRecording의 "폼 자동 채우기" 콜 이식).
 * 13섹션 심층분석과 별개의 포커스 프롬프트로, 웹훅에서 Promise.all 병렬 실행.
 * 결과는 `buildFormPatch`(순수)가 빈 필드만 골라 DB 패치로 변환.
 */
export async function extractConsultationForm(
  formattedTranscript: string,
  ctx: ExtractContext,
  keyName: AiKeyName = "default",
  provider?: AiProvider,
): Promise<{ form: ExtractedConsultationForm; model: string }> {
  const { data, model } = await generateJSON<unknown>({
    keyName,
    provider,
    // 16000 — Claude 5는 생각 토큰도 이 상한에 든다. 4096일 때 긴 녹음에서 답이 잘려 양식이 안 채워졌다(운영 7일 57건 중 21건 ·
    // 비교 시험 10건 중 4건, 2026-10-19). 기본 모델은 Claude Sonnet 5.5(`FEATURE_MODELS`, 2026-10-26 — 그 전 10-19~ V4.1 flash) — 생각 토큰까지 들어가게.
    maxTokens: 16000,
    meta: { feature: "enrollment_form_extract", tenantId: ctx.tenantId },
    prompt: buildConsultationFormPrompt(formattedTranscript, ctx),
  });
  // 저장 전 후처리 — 모델이 바뀌어도 칸 값 모양(문자열 · 선택지 표기 · 전화·날짜 형식)을 기존과 같게(2026-10-19).
  return { form: normalizeExtractedForm(data), model };
}
