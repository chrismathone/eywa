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

/**
 * 모델이 준 과목 표현 → 내부 key. 모델은 한글 라벨("수학")로 말하지 내부 키("math")를 모르므로
 * **라벨·키 양쪽을 받아** 해석한다(못 찾으면 null → 호출부가 필터를 걸지 않는다).
 * 하드코딩 금지 규칙대로 후보는 학원설정(buildSubjectMaps.options)에서만 나온다.
 */
export async function subjectResolver(): Promise<(input: string | null | undefined) => string | null> {
  const settings = await getTenantSettings();
  const maps = buildSubjectMaps(settings.operations.subjects);
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "");
  const byLabel = new Map(maps.options.map((o) => [norm(o.label), o.value]));
  const byKey = new Map(maps.options.map((o) => [norm(o.value), o.value]));
  return (input) => {
    if (!input) return null;
    const n = norm(input);
    return byLabel.get(n) ?? byKey.get(n) ?? null;
  };
}

/** 학원설정에 등록된 과목 라벨 목록 — 툴 설명·안내 문구에 "고를 수 있는 값"을 노출할 때. */
export async function subjectLabelList(): Promise<string[]> {
  const settings = await getTenantSettings();
  return buildSubjectMaps(settings.operations.subjects).options.map((o) => o.label);
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

// 인보이스 상태(코드 고정) — 미수 명단·학생 요약 툴 표시용. void/refunded도 실데이터에 존재
// (makeedu 무효 처리·환불) — 누락 시 raw 영문이 모델 답변으로 유출된다.
export const INVOICE_STATUS_LABEL: Record<string, string> = {
  unpaid: "미납",
  partial: "부분납",
  paid: "완납",
  void: "무효",
  refunded: "환불",
};

// 이탈 위험 레벨(코드 고정, retention/risk.ts RiskLevel).
export const RISK_LEVEL_LABEL: Record<string, string> = {
  risk: "위험",
  warn: "주의",
  ok: "안정",
};

// 시스템 역할(코드 고정 — 운영 enum 아님). master 표시 라벨 = "원장"(결정 로그 2026-07-07).
export const SYSTEM_ROLE_LABEL: Record<string, string> = {
  master: "원장",
  admin: "관리자",
  manager: "매니저",
  teacher: "강사",
  counselor: "상담사",
  accountant: "회계",
  viewer: "열람전용",
  student: "학생",
};

// 직원 재직 상태(users.status, 코드 고정).
export const STAFF_STATUS_LABEL: Record<string, string> = {
  active: "재직",
  inactive: "퇴직",
  pending: "대기",
};

// 요일(코드 고정) — 시간표·근무 일정 표시용.
export const DAY_LABEL: Record<string, string> = {
  mon: "월",
  tue: "화",
  wed: "수",
  thu: "목",
  fri: "금",
  sat: "토",
  sun: "일",
};
