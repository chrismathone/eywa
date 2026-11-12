export type MeetingPromptContext = {
  title: string;
  /** 표시용 한국어 날짜 문자열(예: 2026. 4. 17.). */
  heldAt: string;
  attendees: string[];
  /** 작성자가 회의 중/후 직접 작성한 메모. */
  notepad?: string | null;
};

/** 전사·메모 → 회의록 운영 프롬프트의 단일 소스. */
export function buildMeetingAnalysisPrompt(formattedTranscript: string, ctx: MeetingPromptContext): string {
  const notepad = (ctx.notepad ?? "").trim();
  const hasTranscript = formattedTranscript.trim().length > 0;
  const hasNotepad = notepad.length > 0;
  const sourceBlock: string[] = [];
  if (hasTranscript) sourceBlock.push("녹음 전사 (화자 라벨 포함):", formattedTranscript, "");
  if (hasNotepad) {
    sourceBlock.push(
      "작성자 메모 (회의 중 직접 작성 — 핵심·결정·강조사항. 전사와 상충하면 이 메모의 의도를 우선 반영):",
      notepad,
      "",
    );
  }

  return [
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
    ...(hasTranscript
      ? [
          "8. 녹음이 회의 종료 후에도 꺼지지 않아 뒤에 섞인 사담(일상 대화·식사·인사·잡음)은 분석에서 제외하세요. 단, 참석자 일부가 나간 뒤이거나 회의 주제와 다른 이야기라도 학원 업무에 관한 논의·결정(이름·홍보·일정·비용·업무 지시 등)이면 사담이 아니니 회의 내용으로 정리하세요.",
        ]
      : []),
    ...(hasTranscript && hasNotepad
      ? [
          "9. 전사(발화 그대로)와 메모(작성자가 짚은 핵심)를 대조해 하나의 회의록으로 정리하세요. 메모에만 있는 항목도 반드시 반영하고, 전사와 메모가 다르면 메모의 의도를 우선하되 필요하면 둘 다 남기세요. 메모의 축약·약어는 전사 맥락으로 풀어 쓰세요.",
        ]
      : []),
    "",
    ...sourceBlock,
    "JSON schema (모든 필드 한국어, 줄바꿈은 \\n):",
    "{",
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
  ].join("\n");
}
