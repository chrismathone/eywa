import "server-only";
import { generateJSON } from "@/lib/ai/generate";

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

export type MeetingAnalysisContext = {
  title: string;
  /** 표시용 한국어 날짜 문자열(예: 2026. 4. 17.). */
  heldAt: string;
  attendees: string[];
};

/**
 * 8섹션 회의록 분석(+화자→역할 추론) 생성. {report, speakerRoles, model} 반환. 호출부가 try/catch.
 * provider 미지정 = 기본(Solar). 녹음·텍스트 재분석 모두 이 함수를 거친다.
 */
export async function analyzeMeeting(
  formattedTranscript: string,
  ctx: MeetingAnalysisContext,
): Promise<{ report: MeetingReport; speakerRoles: Record<string, string>; model: string }> {
  const { data: parsed, model } = await generateJSON<
    MeetingReport & { speakerRoles?: Record<string, string> }
  >({
    maxTokens: 8192,
    prompt: [
      "다음은 학원 회의 녹음 전사입니다. 회의록 형태로 분석해 JSON으로만 답해주세요.",
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
      "",
      "녹음 전사 (화자 라벨 포함):",
      formattedTranscript,
      "",
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
