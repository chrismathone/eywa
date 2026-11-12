import { CONSULTATION_PATHS, RELATION_OPTIONS } from "./form-config";

export type ConsultationFormPromptContext = {
  studentName: string;
  grade?: string | null;
  school?: string | null;
};

/** 등록상담 전사 → 폼 자동입력 운영 프롬프트의 단일 소스. */
export function buildConsultationFormPrompt(
  formattedTranscript: string,
  ctx: ConsultationFormPromptContext,
): string {
  return [
    "당신은 학원 신입생 등록상담 녹음을 분석해 상담 기록 양식에 맞게 구조화하는 전문가입니다.",
    "아래 전사에서 명확히 언급된 정보만 추출해 JSON으로만 답하세요. 추측 금지 — 언급 안 된 필드는 빈 문자열(\"\").",
    "",
    `학생(현재 입력값): ${ctx.studentName}`,
    `학년(현재 입력값): ${ctx.grade ?? "미상"}`,
    `학교(현재 입력값): ${ctx.school ?? "미상"}`,
    "",
    "전사 (화자 라벨 포함):",
    formattedTranscript,
    "",
    "추출할 JSON schema (모든 값 한국어, 미언급은 \"\"):",
    "{",
    '  "schoolName": "학교 이름",',
    '  "grade": "학년 (초1~초6, 중1~중3, 고1~고3 중 하나)",',
    '  "parentName": "보호자 이름",',
    '  "parentPhone": "보호자 전화번호 (010-0000-0000 형식)",',
    `  "parentRelation": "보호자 관계 (${RELATION_OPTIONS.join("/")} 중 하나)",`,
    '  "gender": "성별 (남/여)",',
    '  "birthDate": "생년월일 (YYYY-MM-DD)",',
    '  "address": "주소",',
    `  "consultationPath": "상담 경로 (${CONSULTATION_PATHS.join("/")} 중 하나)",`,
    '  "careerGoal": "희망 진로",',
    '  "siblings": "형제관계 (예: 외동, 형 1명 등)",',
    '  "safetyNotes": "안전/주의사항 (알레르기·건강 등)",',
    '  "shuttleBusRequest": "셔틀 신청 여부 (true/false)",',
    '  "subject": "주요 상담 과목 (수학/영어/국어/과학/기타 중 하나)",',
    '  "parentRequest": "학부모 요구사항 (학부모가 직접 요청한 것만 2~4문장 요약)",',
    '  "prevAcademy": "다녔거나 지금 다니는 학원 이름만 — 전사 표기 그대로, 여럿이면 쉼표로(기간·과목·다닌 사정은 subjectDetails의 academyHistory에) · 이름이 안 나왔으면 \\\"\\\"",',
    '  "lastScore": "최근 성적/점수",',
    '  "weakSubjects": "약점 단원/영역 (쉼표로 구분)",',
    '  "followUpContent": "후속 조치 계획",',
    '  "nonRegistrationReason": "미등록 사유 (해당 시)",',
    '  "subjectDetails": {',
    '    "math":    { "academyHistory": "", "learningProgress": "", "examResults": "", "recommendedClass": "", "levelTestScore": "", "notes": "" },',
    '    "english": { "academyHistory": "", "learningProgress": "", "examResults": "", "recommendedClass": "", "notes": "" },',
    '    "korean":  { "academyHistory": "", "learningProgress": "", "levelTestScore": "", "notes": "" },',
    '    "science": { "academyHistory": "", "learningProgress": "", "levelTestScore": "", "notes": "" }',
    "  }",
    "}",
    "",
    "JSON만 출력. 마크다운 코드 블록 없이.",
  ].join("\n");
}
