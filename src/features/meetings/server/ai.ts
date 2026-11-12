import "server-only";
import { generateJSON } from "@/lib/ai/generate";
import type { AiProvider } from "@/lib/ai/models";
import { trimTrailingNoise, type TrimUtterance } from "@/lib/ai/transcript-trim";
import { normalizeMeetingAnalysis } from "../analysis-normalize";
import { buildMeetingAnalysisPrompt, type MeetingPromptContext } from "../analysis-prompt";

/**
 * 회의록 8섹션 분석 — 단일 소스. 웹훅(오디오 전사 후)·텍스트 재분석 액션(regenerateMeetingAnalysis)이 공유한다.
 * (등록상담 13섹션·재원생 케어 7섹션과 같은 "분석 프롬프트를 한 함수에 모은다" 패턴.)
 */
export type MeetingReport = {
  meetingType: string;
  summary: string;
  agendaDiscussion: string;
  decisions: string;
  actionItems: string;
  speakerSummary: string;
  concerns: string;
  nextSteps: string;
};

type SpeakerUtterance = { speaker: string; text: string };

/**
 * 전사 텍스트 + 화자 라벨(speaker_labels jsonb) → `[화자 A] …` 포맷.
 * 웹훅과 재분석 액션이 **같은 포맷**을 쓰도록 단일화(포맷 불일치 방지).
 */
export function formatMeetingTranscript(transcription: string, speakerLabels: unknown): string {
  const utts = Array.isArray(speakerLabels) ? (speakerLabels as SpeakerUtterance[]) : [];
  if (utts.length > 0) {
    return utts.map((s) => `[화자 ${s.speaker}] ${s.text}`).join("\n");
  }
  return transcription;
}

/**
 * 분석 입력용 전사(B) — 회의 종료 후 못 끄고 섞인 뒷부분 잡음 꼬리를 잘라낸 뒤 포맷한다.
 * 화자 라벨(타임스탬프)이 있을 때만 트림 가능 — 없으면(옛 통짜 전사) 원문 그대로(프롬프트 지침 C가 방어).
 * removedCount/removedDurationSec는 호출부가 로깅·표시에 쓸 수 있다(안 잘렸으면 0).
 * 저장(raw transcription·speaker_labels)은 건드리지 않음 — 오직 분석에 넣는 텍스트만 잘라낸다.
 */
export function buildMeetingAnalysisInput(
  transcription: string,
  speakerLabels: unknown,
): { formatted: string; removedCount: number; removedDurationSec: number } {
  const utts = Array.isArray(speakerLabels) ? (speakerLabels as TrimUtterance[]) : [];
  if (utts.length === 0) {
    return { formatted: transcription, removedCount: 0, removedDurationSec: 0 };
  }
  const { kept, removed, removedDurationSec } = trimTrailingNoise(utts);
  return {
    formatted: kept.map((s) => `[화자 ${s.speaker}] ${s.text}`).join("\n"),
    removedCount: removed.length,
    removedDurationSec,
  };
}

export type MeetingAnalysisContext = MeetingPromptContext & {
  /**
   * 작성자가 회의 중/후 직접 작성한 메모(메모장). 있으면 전사와 **함께** 분석 입력으로 결합한다.
   * 메모만 있고 전사가 없으면 메모만으로 정리한다. 전사만일 땐(메모 없음) 프롬프트가 기존과 바이트 동일.
   */
  notepad?: string | null;
  /**
   * usage 귀속 전용(`ai_usage_logs.tenant_id`) — 프롬프트엔 안 들어간다. 지점이 둘 이상이면 비용을 지점별로 가르는 유일한 단서.
   * 🔴 **필수**다(모르면 null을 **명시**) — optional로 두면 새 호출부가 빼먹어도 컴파일·가드가 둘 다 초록인 채 빈칸이 쌓인다
   *    (가드는 generateJSON의 meta에 속성이 **있는지**만 본다 · 적대 리뷰 2026-09-21).
   */
  /** 지점 — AI 라이선스·사용량 귀속. 필수(없으면 generateJSON이 거절한다). */
  tenantId: string;
};

/**
 * 8섹션 회의록 분석(+화자→역할 추론) 생성. {report, speakerRoles, model} 반환. 호출부가 try/catch.
 * 코드 기본 고정 = Claude Sonnet 5.5(model-pins.ts, 2026-10-26 — 그 전 10-19~ V4.1 flash). 녹음·텍스트 재분석 모두 이 함수를 거친다.
 *
 * 입력은 **전사 + 메모장 결합** — 셋 중 하나: (전사만) / (메모만) / (둘 다). 둘 다면 전사(발화 그대로)와
 * 메모(작성자가 짚은 핵심)를 종합하고, 상충 시 메모의 의도를 우선하되 필요하면 둘 다 남긴다.
 */
export async function analyzeMeeting(
  formattedTranscript: string,
  ctx: MeetingAnalysisContext,
  provider: AiProvider = "anthropic", // 전사 분석 = Claude Sonnet 5.5(2026-10-26 원장). 막히면 무중단 폴백(ChatGPT).
): Promise<{ report: MeetingReport; speakerRoles: Record<string, string>; model: string }> {
  const { data: parsed, model } = await generateJSON<
    MeetingReport & { speakerRoles?: Record<string, string> }
  >({
    // 16000 = Claude 5 계열을 고르거나 폴백으로 넘어가도 생각 토큰까지 들어가게(폼 추출이 4,096에서 잘리던 것과 같은 함정, 2026-10-19).
    // 폴백 모델도 generate.ts의 공통 바닥을 적용한다. 상한일 뿐 쓴 만큼만 과금된다.
    maxTokens: 16000,
    meta: { feature: "meeting_analysis", tenantId: ctx.tenantId },
    provider,
    prompt: buildMeetingAnalysisPrompt(formattedTranscript, ctx),
  });

  // 저장 전 후처리 — 모델이 바뀌어도 기존 저장본과 같은 모양(불릿·굵게 짝·화자 표기 '원장(A)')으로(2026-10-19).
  const { report, speakerRoles } = normalizeMeetingAnalysis(parsed);
  return { report, speakerRoles, model };
}
