/**
 * 운영 콘솔 'AI 모델' 탭의 줄 — 지점마다 모델을 고를 수 있는 AI 기능(원장 2026-10-19 *"지점별로 ai모델 바꿀 수 있게"*).
 * 순수 모듈(서버·클라 공용). 기능 이름은 `generateJSON({ meta: { feature } })`의 그 값이다.
 *
 * 🔴 새 AI 기능을 만들면 `FEATURE_KEY_GROUP`(models.ts)과 함께 **여기에도 한 줄**(가드 `model-features.test.ts`).
 * 고를 수 없는 기능은 `FIXED_MODEL_FEATURES`에 이유와 함께 둔다 — 목록에서 빠졌다는 사실이 코드에 남아야 한다.
 * `waits` = 선생님·직원이 버튼을 누르고 화면에서 기다리는 기능 — 추론이 긴 모델(`slow`)은 고를 수 없고 응답 상한도 낮다.
 */
import { AI_MODEL_CHOICES, modelFeatureOf } from "./model-pins";

export type TenantModelFeature = { key: string; label: string; area: string; waits?: true };

export const TENANT_MODEL_FEATURES: readonly TenantModelFeature[] = [
  { key: "classnote_ment", label: "학부모 멘트 자동작성(미리보기 포함)", area: "수업보고서", waits: true },
  { key: "english_ment", label: "영어 AI 코멘트", area: "수업보고서", waits: true },
  { key: "ment_style_profile", label: "선생님 말투 정리(주 1회)", area: "수업보고서" },
  { key: "enrollment_analysis", label: "녹음 심층분석", area: "콜&상담" },
  { key: "enrollment_form_extract", label: "녹음으로 양식 채우기", area: "콜&상담" },
  { key: "enrollment_prep_brief", label: "상담 준비 브리프", area: "콜&상담" },
  { key: "consultation_analysis", label: "녹음 분석", area: "원생상담" },
  // 직원이 버튼을 누르고 결과를 기다린다(서버 액션이 끝까지 기다림 — 2026-10-19 리뷰).
  { key: "student_care", label: "원생 AI 케어", area: "원생상담", waits: true },
  // 원생 흐름 분석(연결 탐색 · 2026-11-03) — 상담 저장 뒤·밤 배치가 돌린다. '다시 분석' 버튼은 기다리지만 응답 상한을 바꾸지 않으려 waits는 두지 않았다(병합 2026-11-05).
  { key: "student_flow_consultations", label: "원생 흐름 분석(상담)", area: "원생상담" },
  { key: "student_flow_timeline", label: "원생 흐름 분석(타임라인)", area: "원생상담" },
  { key: "meeting_analysis", label: "녹음 분석", area: "회의록" },
  { key: "daily_briefing", label: "일일 브리핑", area: "운영실" },
  // 원장 · 관리자가 'AI로 정리'를 누르고 화면에서 기다린다(2026-11-02).
  { key: "dashboard_secretary", label: "업무 비서 정리", area: "운영실", waits: true },
  { key: "attendance_recap", label: "출결 요약", area: "출결" },
  { key: "parent_attendance_intent", label: "학부모 결석 문자 판별", area: "출결" },
  { key: "parent_satisfaction", label: "학부모 글 만족도 판정", area: "강사평가" },
  { key: "student_positive_signal", label: "원생 긍정 신호 판정", area: "원생 로열티" },
  { key: "notice_translate", label: "공지 번역", area: "공지" },
  { key: "staff_contract_pdf", label: "계약서 글자 추출", area: "직원" },
];

/**
 * 고를 수 없는 기능과 그 이유.
 * - 계약서 스캔 인식: 스캔 이미지는 Claude에만 보내도록 원장이 승인했다(2026-08-03) — 다른 회사로 바꾸면 그 승인 밖이다.
 * - Jev 비교: 문장 생성이 아니라 TypeSafe 판정(다른 회사·다른 모양)이라 모델 목록이 없다.
 * - 멘트 미리보기: 운영 자동작성(`classnote_ment`)을 그대로 따른다(`modelFeatureOf`).
 */
export const FIXED_MODEL_FEATURES: Readonly<Record<string, string>> = {
  student_ontology_summary: "학생 기록 요약은 Claude 전용입니다. 현재 fast/low 발췌 요약을 사용합니다.",
  staff_contract_pdf_ocr: "계약서 스캔 인식은 Claude 전용입니다(스캔 이미지 전송 승인 범위).",
  parent_attendance_jev_shadow: "Jev 비교는 TypeSafe 판정이라 모델을 고르지 않습니다.",
  ment_prompt_preview: "멘트 미리보기는 학부모 멘트 자동작성과 같은 모델을 씁니다.",
  // 평점 하네스(체크리스트 + 코드 규칙 7차)는 Claude Haiku 5.5에 맞춰 Codex 대조로 조였다 — 다른 모델이면 그 대조를 다시 해야 한다.
  lesson_report_rating: "수업보고서 평점은 Claude Haiku 5.5에 맞춰 검증한 판정 방식이라 모델을 고르지 않습니다.",
  student_consultation_rating: "원생상담 평점은 같은 기준을 구독 CLI와 배치로 매긴 값을 맞춰 본 Claude 판정이라 모델을 고르지 않습니다.",
  // 영상 설명 AI 참고 메모(2026-10-20) — 학생 영상 화면은 Claude에만 보내도록 승인했고, 판정 Haiku · 확인 Sonnet 조합으로 시험을 통과했다.
  video_review_judge: "영상 설명 판정은 Claude 전용입니다(학생 영상 화면 전송 승인 범위 · 시험을 통과한 조합).",
  video_review_verify: "영상 설명 오류 확인은 Claude 전용입니다(학생 영상 화면 전송 승인 범위 · 시험을 통과한 조합).",
  // 학원 비서(2026-11-06) — 원장이 대화창에서 적음·보통·강함(Haiku·Sonnet·Opus 5.5)을 고른다. 지점 전체 자료를 읽는 기능이라 다른 회사 모델로 바꾸지 않는다.
  academy_assistant: "학원 비서는 Claude 전용입니다 — 추론 강도(적음·보통·강함)는 원장이 대화창에서 고릅니다.",
};

export function isTenantModelFeature(key: unknown): key is string {
  return typeof key === "string" && TENANT_MODEL_FEATURES.some((f) => f.key === key);
}

/** 이 기능에 고를 수 있는 모델 — 기다리는 기능이면 느린 모델을 뺀다(화면 선택지 · 저장 검증이 같은 목록). */
export function modelChoicesFor(key: string) {
  const waits = TENANT_MODEL_FEATURES.find((f) => f.key === key)?.waits === true;
  return AI_MODEL_CHOICES.filter((c) => !(waits && c.slow));
}

/**
 * 사람이 화면에서 기다리는 호출인가(멘트 미리보기는 자동작성을 따른다 — `modelFeatureOf`). 응답 길이 상한을 낮게 둔다
 * (generate.ts `sentMaxTokens` — 응답이 끝없이 이어지는 드문 경우에 몇 분씩 기다리지 않게).
 */
export function waitsForAnswer(feature?: string | null): boolean {
  const key = modelFeatureOf(feature);
  if (key === "student_ontology_summary") return true;
  return TENANT_MODEL_FEATURES.some((f) => f.key === key && f.waits === true);
}
