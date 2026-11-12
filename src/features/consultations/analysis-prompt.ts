/** 재원생 상담 분석의 운영 프롬프트와 후처리. 서버 호출과 공급자 비교 장치가 함께 쓴다. */
export type StudentConsultationReport = {
  summary: string;
  mainTopics: string;
  studentState: string;
  parentConcerns: string;
  actionItems: string;
  followUps: string;
  warnings: string;
};

export type StudentConsultationPromptContext = {
  studentName: string;
  grade: string | null;
  school: string | null;
  consultedAt: string | null;
  audience: string | null;
  category: string | null;
};

const AUDIENCE_LABEL: Record<string, string> = {
  parent: "학부모",
  student: "학생",
  both: "학부모+학생",
};

export function buildStudentConsultationPrompt(
  text: string,
  ctx: StudentConsultationPromptContext,
): string {
  const heldAt = ctx.consultedAt
    ? new Date(ctx.consultedAt).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })
    : "미상";
  return [
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
  ].join("\n");
}

export function normalizeStudentConsultationReport(
  data: Partial<StudentConsultationReport>,
): StudentConsultationReport {
  return {
    summary: data.summary ?? "",
    mainTopics: data.mainTopics ?? "",
    studentState: data.studentState ?? "",
    parentConcerns: data.parentConcerns ?? "",
    actionItems: data.actionItems ?? "",
    followUps: data.followUps ?? "",
    warnings: data.warnings ?? "",
  };
}
