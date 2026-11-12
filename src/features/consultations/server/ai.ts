import "server-only";
import { generateJSON } from "@/lib/ai/generate";
import type { AiProvider } from "@/lib/ai/models";

/**
 * 재원생 학생상담 AI 분석 — 단일 프롬프트 소스.
 * 웹훅(오디오 전사 후)·텍스트 분석 액션이 함께 사용한다.
 * enrollment(신입생)의 13섹션은 영업/등록 맥락이라, 재원생은 **지속 케어 맥락**의 7섹션으로 새로 정의.
 * keyName "consultations" — 학생 케어 인사이트와 같은 과금 버킷.
 */
export type StudentConsultationReport = {
  summary: string; // 2~4문장 요약
  mainTopics: string; // 주요 논의 주제
  studentState: string; // 학생 상태(학습/정서/태도)
  parentConcerns: string; // 학부모 걱정·요청(학부모 상담일 때)
  actionItems: string; // 합의/조치 사항
  followUps: string; // 후속 조치(연락/보강 등)
  warnings: string; // 주의 신호(이탈·정서 위험 등). 없으면 "특이사항 없음".
};

export type StudentConsultationContext = {
  studentName: string;
  grade: string | null;
  school: string | null;
  consultedAt: string | null;
  audience: string | null; // parent / student / both
  category: string | null;
  /**
   * usage 귀속 전용(`ai_usage_logs.tenant_id`) — 프롬프트엔 안 들어간다. 지점이 둘 이상이면 비용을 지점별로 가르는 유일한 단서.
   * 🔴 **필수**다(모르면 null을 **명시**) — optional로 두면 새 호출부가 빼먹어도 컴파일·가드가 둘 다 초록인 채 빈칸이 쌓인다
   *    (가드는 generateJSON의 meta에 속성이 **있는지**만 본다 · 적대 리뷰 2026-09-21).
   */
  /** 지점 — AI 라이선스·사용량 귀속. 필수(없으면 generateJSON이 거절한다). */
  tenantId: string;
};

const AUDIENCE_LABEL: Record<string, string> = {
  parent: "학부모",
  student: "학생",
  both: "학부모+학생",
};

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
  const heldAt = ctx.consultedAt ? new Date(ctx.consultedAt).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" }) : "미상";
  const { data, model } = await generateJSON<StudentConsultationReport>({
    keyName: "consultations",
    provider,
    maxTokens: 4096,
    meta: { feature: "consultation_analysis", tenantId: ctx.tenantId },
    prompt: [
      "다음은 학원 재원생 상담 내용(녹음 전사 또는 상담 메모)입니다. 재원생 케어 관점에서 분석해 JSON으로만 답해주세요.",
      "",
      `학생: ${ctx.studentName} (${ctx.grade ?? "—"}, ${ctx.school ?? "—"})`,
      `상담일: ${heldAt}`,
      `상담 대상: ${ctx.audience ? (AUDIENCE_LABEL[ctx.audience] ?? ctx.audience) : "미상"}`,
      `분류: ${ctx.category ?? "미상"}`,
      "",
      "분석 가이드:",
      "1. summary: 상담 핵심을 2~4문장으로.",
      "2. mainTopics: 다뤄진 주제를 항목으로(- 글머리).",
      "3. studentState: 학생의 학습/정서/태도 상태를 발화 근거로.",
      "4. parentConcerns: 학부모가 표현한 걱정·요청(학부모 상담이 아니면 '해당 없음').",
      "5. actionItems: 상담 중 합의되거나 정해진 조치.",
      "6. followUps: 향후 후속 조치(연락·보강·재상담 등).",
      "7. warnings: 이탈·정서·가정 등 주의 신호. 없으면 '특이사항 없음'.",
      "8. 녹음 전사인 경우, 상담 종료 후에도 녹음이 꺼지지 않아 뒤에 섞인 무관한 대화·잡담·인사·잡음은 분석에서 제외하고 실제 상담 내용만 분석하세요.",
      "",
      "상담 내용:",
      text,
      "",
      "JSON schema (모든 필드 한국어 문자열, 줄바꿈은 \\n):",
      "{",
      '  "summary": string,',
      '  "mainTopics": string,',
      '  "studentState": string,',
      '  "parentConcerns": string,',
      '  "actionItems": string,',
      '  "followUps": string,',
      '  "warnings": string',
      "}",
      "",
      "추측 금지 — 내용에 없는 정보는 빈 문자열 또는 '해당 없음'. JSON만 출력, 마크다운 코드 블록 없이.",
    ].join("\n"),
  });

  const report: StudentConsultationReport = {
    summary: data.summary ?? "",
    mainTopics: data.mainTopics ?? "",
    studentState: data.studentState ?? "",
    parentConcerns: data.parentConcerns ?? "",
    actionItems: data.actionItems ?? "",
    followUps: data.followUps ?? "",
    warnings: data.warnings ?? "",
  };
  return { report, model };
}
