import "server-only";
import { generateJSON } from "@/lib/ai/generate";
import type { AiProvider } from "@/lib/ai/models";
import { trimTrailingNoise, type TrimUtterance } from "@/lib/ai/transcript-trim";

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

export type MeetingAnalysisContext = {
  title: string;
  /** 표시용 한국어 날짜 문자열(예: 2026. 4. 17.). */
  heldAt: string;
  attendees: string[];
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
 * provider 미지정 = 기본(Solar). 녹음·텍스트 재분석 모두 이 함수를 거친다.
 *
 * 입력은 **전사 + 메모장 결합** — 셋 중 하나: (전사만) / (메모만) / (둘 다). 둘 다면 전사(발화 그대로)와
 * 메모(작성자가 짚은 핵심)를 종합하고, 상충 시 메모의 의도를 우선하되 필요하면 둘 다 남긴다.
 */
export async function analyzeMeeting(
  formattedTranscript: string,
  ctx: MeetingAnalysisContext,
  provider: AiProvider = "deepseek", // 전사 분석 기본 = DeepSeek v4-pro(2026-07-16). 키 없으면 무중단 폴백.
): Promise<{ report: MeetingReport; speakerRoles: Record<string, string>; model: string }> {
  const notepad = (ctx.notepad ?? "").trim();
  const hasTranscript = formattedTranscript.trim().length > 0;
  const hasNotepad = notepad.length > 0;

  // 자료 블록 — 있는 것만. 둘 다면 전사 → 메모 순.
  const sourceBlock: string[] = [];
  if (hasTranscript) sourceBlock.push("녹음 전사 (화자 라벨 포함):", formattedTranscript, "");
  if (hasNotepad) {
    sourceBlock.push(
      "작성자 메모 (회의 중 직접 작성 — 핵심·결정·강조사항. 전사와 상충하면 이 메모의 의도를 우선 반영):",
      notepad,
      "",
    );
  }

  const { data: parsed, model } = await generateJSON<
    MeetingReport & { speakerRoles?: Record<string, string> }
  >({
    maxTokens: 8192,
    meta: { feature: "meeting_analysis", tenantId: ctx.tenantId },
    provider,
    prompt: [
      // 전사만(메모 없음)일 땐 기존과 바이트 동일한 인트로 — 기존 품질 회귀 방지.
      hasTranscript && hasNotepad
        ? "다음은 학원 회의의 녹음 전사와 작성자가 직접 남긴 메모입니다. 두 자료를 종합해 회의록 형태로 분석해 JSON으로만 답해주세요."
        : hasNotepad
          ? "다음은 학원 회의에서 작성자가 직접 남긴 메모입니다. 회의록 형태로 분석해 JSON으로만 답해주세요."
          : "다음은 학원 회의 녹음 전사입니다. 회의록 형태로 분석해 JSON으로만 답해주세요.",
      "",
      `제목: ${ctx.title}`,
      `일시: ${ctx.heldAt}`,
      `참석자: ${ctx.attendees.length > 0 ? ctx.attendees.join(", ") : "미상"}`,
      "",
      "출력 형식 규칙(중요):",
      "- 나열형 섹션(agendaDiscussion/decisions/actionItems/speakerSummary/concerns/nextSteps)은 각 항목을 줄바꿈(\\n)으로 구분하고 항목 앞에 '- '를 붙이세요.",
      "- 핵심어(담당자·기한·금액·결정 키워드 등)는 **굵게**로 강조하세요(예: **6/5까지**, **박부장**).",
      "",
      "분석 시 반드시 주의할 점:",
      "1. 회의의 유형을 정확히 파악하세요 (예: 정기 운영회의, 강사 회의, 학부모 간담회).",
      "2. 안건별로 논의 내용을 분리하세요.",
      "3. 결정 사항은 '누가 제안했고, 반대 의견은, 최종 결정' 형식으로 정리.",
      "4. 액션 아이템은 담당자와 기한을 가능한 명시.",
      "5. 참석자별 발언을 중립적으로 기록하세요.",
      "6. 미해결 이슈, 갈등, 위험 요소를 별도로 기록하세요.",
      "7. 향후 계획을 반드시 포함하세요.",
      // 전사가 있을 때만(C) — 녹음을 못 끄고 섞인 회의 무관 잡음/잡담을 분석에서 제외. B(코드 트림)가 대부분 잘라내지만
      // gap 신호가 없는 잡담(연속 대화)은 이 지침이 backstop. 메모만일 땐 미삽입.
      ...(hasTranscript
        ? [
            "8. 녹음이 회의 종료 후에도 꺼지지 않아 뒤에 섞인, 회의와 무관한 대화·잡담·인사·잡음은 분석에서 제외하고 실제 회의 내용만 정리하세요. 전사 끝부분에 회의 주제와 동떨어진 사담이 이어지면 무시하세요.",
          ]
        : []),
      // 둘 다일 때만 결합 지침(전사만이면 미삽입 → 프롬프트 바이트 동일).
      ...(hasTranscript && hasNotepad
        ? [
            "9. 전사(발화 그대로)와 메모(작성자가 짚은 핵심)를 대조해 하나의 회의록으로 정리하세요. 메모에만 있는 항목도 반드시 반영하고, 전사와 메모가 다르면 메모의 의도를 우선하되 필요하면 둘 다 남기세요. 메모의 축약·약어는 전사 맥락으로 풀어 쓰세요.",
          ]
        : []),
      "",
      ...sourceBlock,
      "JSON schema (모든 필드 한국어, 줄바꿈은 \\n):",
      "{",
      '  "speakerRoles": { "A": "역할/이름", "B": "역할/이름" },',
      '  "meetingType": string,',
      '  "summary": string (2-4문장),',
      '  "agendaDiscussion": string,',
      '  "decisions": string,',
      '  "actionItems": string,',
      '  "speakerSummary": string,',
      '  "concerns": string,',
      '  "nextSteps": string',
      "}",
      "",
      "JSON만 출력. 마크다운 코드 블록 없이.",
    ].join("\n"),
  });

  const report: MeetingReport = {
    meetingType: parsed.meetingType ?? "",
    summary: parsed.summary ?? "",
    agendaDiscussion: parsed.agendaDiscussion ?? "",
    decisions: parsed.decisions ?? "",
    actionItems: parsed.actionItems ?? "",
    speakerSummary: parsed.speakerSummary ?? "",
    concerns: parsed.concerns ?? "",
    nextSteps: parsed.nextSteps ?? "",
  };
  return { report, speakerRoles: parsed.speakerRoles ?? {}, model };
}
