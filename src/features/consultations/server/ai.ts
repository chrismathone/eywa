import "server-only";
import { generateJSON } from "@/lib/ai/generate";
import type { AiProvider } from "@/lib/ai/models";
import {
  buildStudentConsultationPrompt,
  normalizeStudentConsultationReport,
  type StudentConsultationPromptContext,
  type StudentConsultationReport,
} from "@/features/consultations/analysis-prompt";

/**
 * 재원생 학생상담 AI 분석 — 단일 프롬프트 소스.
 * 웹훅(오디오 전사 후)·텍스트 분석 액션이 함께 사용한다.
 * enrollment(신입생)의 13섹션은 영업/등록 맥락이라, 재원생은 **지속 케어 맥락**의 7섹션으로 새로 정의.
 * keyName "consultations" — 학생 케어 인사이트와 같은 과금 버킷.
 */
export type StudentConsultationContext = StudentConsultationPromptContext & {
  /**
   * usage 귀속 전용(`ai_usage_logs.tenant_id`) — 프롬프트엔 안 들어간다. 지점이 둘 이상이면 비용을 지점별로 가르는 유일한 단서.
   * 🔴 **필수**다(모르면 null을 **명시**) — optional로 두면 새 호출부가 빼먹어도 컴파일·가드가 둘 다 초록인 채 빈칸이 쌓인다
   *    (가드는 generateJSON의 meta에 속성이 **있는지**만 본다 · 적대 리뷰 2026-09-21).
   */
  /** 지점 — AI 라이선스·사용량 귀속. 필수(없으면 generateJSON이 거절한다). */
  tenantId: string;
};

export type { StudentConsultationReport } from "@/features/consultations/analysis-prompt";

/**
 * 전사/메모 텍스트 + 학생 컨텍스트로 7섹션 분석 생성. {report, model} 반환. 호출부가 try/catch.
 * `provider` 기본 = Claude Sonnet 5.5(2026-10-26 원장 *"전사 분석은 전부 sonnet 5.5로"*).
 * Claude가 막히면 무중단 폴백(ChatGPT). 다른 모델로 바꾸려면 호출부에서 provider 오버라이드.
 */
export async function analyzeStudentConsultation(
  text: string,
  ctx: StudentConsultationContext,
  provider: AiProvider = "anthropic",
): Promise<{ report: StudentConsultationReport; model: string }> {
  const { data, model } = await generateJSON<StudentConsultationReport>({
    keyName: "consultations",
    provider,
    maxTokens: 4096,
    meta: { feature: "consultation_analysis", tenantId: ctx.tenantId },
    prompt: buildStudentConsultationPrompt(text, ctx),
  });

  const report = normalizeStudentConsultationReport(data);
  return { report, model };
}
