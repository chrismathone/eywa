import "server-only";
import { generateJSON } from "@/lib/ai/generate";
import type { AiProvider } from "@/lib/ai/models";
import { trimTrailingNoise, type TrimUtterance } from "@/lib/ai/transcript-trim";
import { normalizeMeetingAnalysis } from "../analysis-normalize";

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
    // 16000 = Claude 5 계열을 고르거나 폴백으로 넘어가도 생각 토큰까지 들어가게(폼 추출이 4,096에서 잘리던 것과 같은 함정, 2026-10-19).
    // 폴백 모델도 generate.ts의 공통 바닥을 적용한다. 상한일 뿐 쓴 만큼만 과금된다.
    maxTokens: 16000,
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
      "- 본문에서 사람은 speakerRoles 이름표 뒤에 화자 글자를 붙여 부르세요(예: **대표(B)**, 허은진(A)). 이름표가 빈 화자만 '화자 A'로 쓰고, 'A는'·'B가'처럼 글자만 쓰지 마세요.",
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
            "8. 녹음이 회의 종료 후에도 꺼지지 않아 뒤에 섞인 사담(일상 대화·식사·인사·잡음)은 분석에서 제외하세요. 단, 참석자 일부가 나간 뒤이거나 회의 주제와 다른 이야기라도 학원 업무에 관한 논의·결정(이름·홍보·일정·비용·업무 지시 등)이면 사담이 아니니 회의 내용으로 정리하세요.",
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
      // speakerEvidence = 이름표를 정한 근거를 적는 자리(저장 전 후처리가 버린다 — analysis-normalize는 모르는 칸을 남기지 않는다).
      // 2026-10-26 시험: 이름표만 짧게 쓰게 하자 근거를 적을 자리가 없어 '대표님' 호칭의 주인을 거꾸로 짚는 일이 생겼다.
      '  "speakerEvidence": { "A": "이 화자를 누구로 본 근거 한 줄(누가 이 화자를 어떤 호칭으로 불렀는지 · 자기소개 · 참석자 명단)" },',
      '  "speakerRoles": { "A": "이름이나 직함 1~3낱말(예: \\"대표\\", \\"이승엽 대리\\") — 전사에서 그렇게 불렸으면 그대로, 참석자 명단으로만 짐작했으면 뒤에 (추정) · 근거가 없으면 \\"\\" · 설명은 쓰지 않는다" },',
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

  // 저장 전 후처리 — 모델이 바뀌어도 기존 저장본과 같은 모양(불릿·굵게 짝·화자 표기 '원장(A)')으로(2026-10-19).
  const { report, speakerRoles } = normalizeMeetingAnalysis(parsed);
  return { report, speakerRoles, model };
}
