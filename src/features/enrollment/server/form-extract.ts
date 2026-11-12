import "server-only";
import { generateJSON } from "@/lib/ai/generate";
import type { AiKeyName, AiProvider } from "@/lib/ai/models";
import type { ExtractedConsultationForm } from "../form-fill";
import { normalizeExtractedForm } from "../form-normalize";
import {
  RELATION_OPTIONS,
  CONSULTATION_PATHS,
} from "../form-config";

export type ExtractContext = {
  studentName: string;
  grade?: string | null;
  school?: string | null;
  /**
   * usage 귀속 전용(`ai_usage_logs.tenant_id`) — 프롬프트엔 안 들어간다. 지점이 둘 이상이면 비용을 지점별로 가르는 유일한 단서.
   * 🔴 **필수**다(모르면 null을 **명시**) — optional로 두면 새 호출부가 빼먹어도 컴파일·가드가 둘 다 초록인 채 빈칸이 쌓인다
   *    (가드는 generateJSON의 meta에 속성이 **있는지**만 본다 · 적대 리뷰 2026-09-21).
   */
  /** 지점 — AI 라이선스·사용량 귀속. 필수(없으면 generateJSON이 거절한다). */
  tenantId: string;
  /** 꺼진 지점에서는 셔틀 칸 자체를 추출 프롬프트에 넣지 않는다. */
  shuttleOn?: boolean;
};

/**
 * 등록상담 전사 → 폼 필드 구조화 추출(ijw processRegistrationRecording의 "폼 자동 채우기" 콜 이식).
 * 13섹션 심층분석과 별개의 포커스 프롬프트로, 웹훅에서 Promise.all 병렬 실행.
 * 결과는 `buildFormPatch`(순수)가 빈 필드만 골라 DB 패치로 변환.
 */
export async function extractConsultationForm(
  formattedTranscript: string,
  ctx: ExtractContext,
  keyName: AiKeyName = "default",
  provider?: AiProvider,
): Promise<{ form: ExtractedConsultationForm; model: string }> {
  const { data, model } = await generateJSON<unknown>({
    keyName,
    provider,
    // 16000 — Claude 5는 생각 토큰도 이 상한에 든다. 4096일 때 긴 녹음에서 답이 잘려 양식이 안 채워졌다(운영 7일 57건 중 21건 ·
    // 비교 시험 10건 중 4건, 2026-10-19). 기본 모델은 Claude Sonnet 5.5(`FEATURE_MODELS`, 2026-10-26 — 그 전 10-19~ V4.1 flash) — 생각 토큰까지 들어가게.
    maxTokens: 16000,
    meta: { feature: "enrollment_form_extract", tenantId: ctx.tenantId },
    prompt: [
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
      ...(ctx.shuttleOn === false ? [] : ['  "shuttleBusRequest": "셔틀 신청 여부 (true/false)",']),
      '  "subject": "주요 상담 과목 (수학/영어/국어/과학/기타 중 하나)",',
      '  "parentRequest": "학부모 요구사항 (학부모가 직접 요청한 것만 2~4문장 요약)",',
      '  "prevAcademy": "다녔거나 지금 다니는 학원 이름만 — 전사 표기 그대로, 여럿이면 쉼표로(기간·과목·다닌 사정은 subjectDetails의 academyHistory에) · 이름이 안 나왔으면 \\"\\"",',
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
    ].join("\n"),
  });
  // 저장 전 후처리 — 모델이 바뀌어도 칸 값 모양(문자열 · 선택지 표기 · 전화·날짜 형식)을 기존과 같게(2026-10-19).
  return { form: normalizeExtractedForm(data), model };
}
