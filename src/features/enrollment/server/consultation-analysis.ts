import { generateJSON } from "@/lib/ai/generate";
import type { AiProvider } from "@/lib/ai/models";
import { normalizeConsultationReport, type NormalizedConsultationReport } from "../analysis-normalize";
import { buildConsultationAnalysisPrompt, type ConsultationPromptInput } from "../consultation-analysis-prompt";
export type { ConsultationPromptInput, ConsultationReport13, ConversationFlowNode } from "../consultation-analysis-prompt";

/**
 * 등록상담 AI 심층분석 — 프롬프트·호출 단일 소스.
 * AssemblyAI 웹훅(최초 분석)과 재분석 서버액션이 공유한다(프롬프트 중복 금지 = generateJSON 단일 진입점 원칙).
 * ijw functions/index.js processRegistrationRecording 프롬프트를 이식(- 불릿 + \n 줄바꿈, 마크다운 볼드 금지).
 */


/**
 * 심층분석 실행 — generateJSON 결과({ data, model })를 반환하되 data는 **저장 전 후처리**를 거친 13섹션이다
 * (analysis-normalize.ts — 모델이 바뀌어도 기존 저장본과 같은 모양: 나열 섹션 불릿 · 산문 섹션 문장 · 굵게·화자 기호 없음).
 * 웹훅(최초 분석)과 재분석이 **둘 다 이 함수**를 부른다(2026-10-19 — 그 전엔 웹훅에 같은 프롬프트 복사본이 있었다).
 * 모델 = 코드 기본 `FEATURE_MODELS.enrollment_analysis`(Claude Sonnet 5.5, 2026-10-26 — 그 전 10-19~ V4.1 flash) 또는 지점이 운영 콘솔에서 고른 것.
 * provider 인자는 고정 모델이 없을 때의 선호(키 없으면 무중단 폴백).
 */
export async function runConsultationAnalysis(
  consult: ConsultationPromptInput,
  formatted: string,
  multi: boolean,
  provider: AiProvider = "anthropic",
  /** usage 귀속 전용(`ai_usage_logs.tenant_id`) — 프롬프트엔 안 들어간다. 🔴 필수(모르면 null 명시) — optional이면 빼먹어도 초록이다. */
  opts: { tenantId: string },
): Promise<{ data: NormalizedConsultationReport; model: string }> {
  const res = await generateJSON<unknown>({
    // 16000 = Claude 5 계열을 고르거나 폴백으로 넘어가도 생각 토큰까지 들어가게(2026-10-19). 쓴 만큼만 과금된다.
    maxTokens: 16000,
    meta: { feature: "enrollment_analysis", tenantId: opts.tenantId },
    prompt: buildConsultationAnalysisPrompt(consult, formatted, multi),
    provider,
  });
  return { data: normalizeConsultationReport(res.data, { multi, inputName: consult.prospect_name }), model: res.model };
}
