import "server-only";
// AI 비서 툴 결과에 넣을 한글 라벨 헬퍼 — 툴 결과는 모델 입력이지만 모델이 그대로 답에 옮기는 일이
// 잦아, raw enum(math·withdrawn 등)을 모델에게 주지 않고 서버에서 라벨링해 준다("raw 코드 노출 금지"의
// 상류 차단). 과목은 학원설정 단일 소스(buildSubjectMaps) — 하드코딩 금지 규칙 준수.

import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";

/** 과목 key → 한글 라벨 함수(설정 기반). 요청당 getTenantSettings는 React cache로 1회. */
export async function subjectLabeler(): Promise<(key: string | null | undefined) => string | null> {
  const settings = await getTenantSettings();
  const maps = buildSubjectMaps(settings.operations.subjects);
  return (key) => (key ? maps.labelOf(key) : null);
}

// 재원생 상담 카테고리(코드 고정 도메인 enum — 운영 enum 아님). consultation-meta.ts와 동일 어휘.
export const CONSULTATION_CATEGORY_LABEL: Record<string, string> = {
  general: "일반",
  academic: "학습",
  emotional: "정서",
  career: "진로",
  social: "교우관계",
  other: "기타",
};

// 인보이스 상태(코드 고정) — 미수 명단 툴 표시용.
export const INVOICE_STATUS_LABEL: Record<string, string> = {
  unpaid: "미납",
  partial: "부분납",
  paid: "완납",
};

// 이탈 위험 레벨(코드 고정, retention/risk.ts RiskLevel).
export const RISK_LEVEL_LABEL: Record<string, string> = {
  risk: "위험",
  warn: "주의",
  ok: "안정",
};
