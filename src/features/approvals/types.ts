/**
 * 전자결재 공용 타입·**한글 라벨**. server-only 아님(클라 컴포넌트도 import).
 *
 * 구조는 그룹웨어 표준을 따른다 — 기안 → 결재선 **순차** → 결재대기/상신함/완료함.
 * ⚠️ DB 값(`pending`·`approved`…)을 화면에 그대로 내보내지 않는다 — 매핑은 여기 한 곳.
 */

import type { PillColor } from "@/components/atoms/pill";

/** 결재 양식(원장 확정 2026-08-18: 휴가·품의·지출·수입 — 업무연락 폐기). 추가는 여기 + DB check + 상세 표. */
export const APPROVAL_FORMS = ["leave", "proposal", "expense", "income"] as const;
export type ApprovalForm = (typeof APPROVAL_FORMS)[number];

export const APPROVAL_FORM_LABEL: Record<ApprovalForm, string> = {
  leave: "휴가신청서",
  proposal: "품의서",
  expense: "지출결의서",
  income: "수입결의서",
};

/** 양식 고르기 화면의 한 줄 설명 — 무엇에 쓰는 문서인지(작성 화면과 목록이 공유). */
export const APPROVAL_FORM_DESC: Record<ApprovalForm, string> = {
  leave: "연차·반차를 신청합니다. 잔여 연차는 입사일 기준 법정 일수에서 자동 계산됩니다.",
  proposal: "구매·계약·행사 등 결정이 필요한 안건을 올려 승인 받습니다.",
  expense: "지출 내역(금액·지출일·분류)을 올려 승인 받습니다.",
  income: "수강료 외 수입(교재 판매·특강 등)의 내역을 올려 승인 받습니다.",
};

/** 문서번호 앞머리 — '휴가-2026-0001'. 사람이 부르는 이름이라 판정엔 쓰지 않는다. */
export const APPROVAL_FORM_PREFIX: Record<ApprovalForm, string> = {
  leave: "휴가",
  proposal: "품의",
  expense: "지출",
  income: "수입",
};

/** 지출결의서 분류 — 기존 /billing 지출과 같은 어휘(실운영 통합 대비). 어휘의 주인은 billing. */
export const EXPENSE_CATEGORIES = ["인건비", "운영비", "매입", "마케팅", "기타"] as const;

/** 수입결의서 분류 — 수강료는 수납관리 소관이라 없다(수강료 외 수입). 어휘는 파일럿 중 원장 확정 대상. */
export const INCOME_CATEGORIES = ["교재 판매", "특강·행사", "기타"] as const;

export function isApprovalForm(v: string): v is ApprovalForm {
  return (APPROVAL_FORMS as readonly string[]).includes(v);
}

/** 문서 상태. `canceled` = 기안자가 회수한 것(반려와 구분한다 — 누가 끝냈는지가 다르다). */
export const DOC_STATUSES = ["pending", "approved", "rejected", "canceled"] as const;
export type DocStatus = (typeof DOC_STATUSES)[number];

export function docStatusLabel(status: DocStatus): { label: string; color: PillColor } {
  if (status === "approved") return { label: "승인", color: "green" };
  if (status === "rejected") return { label: "반려", color: "danger" };
  if (status === "canceled") return { label: "회수", color: "neutral" };
  return { label: "진행중", color: "blue" };
}

/**
 * 결재란 한 칸의 판단(0216a 특수 결재 포함):
 *   final = **전결**(그 칸에서 문서 즉시 승인 종결) · skipped = 전결로 생략된 칸 ·
 *   deferred = **후결 대기**(부재로 건너뜀 — 다음 사람이 먼저 결재) · post_approved = 후결 확인 완료.
 * 대결은 decision이 아니라 **acted_by**(실제 처리자)로 표현한다 — 승인/반려 판단 자체는 같다.
 */
export const STEP_DECISIONS = [
  "pending",
  "approved",
  "rejected",
  "final",
  "deferred",
  "post_approved",
  "skipped",
] as const;
export type StepDecision = (typeof STEP_DECISIONS)[number];

export const STEP_DECISION_LABEL: Record<StepDecision, string> = {
  pending: "대기",
  approved: "승인",
  rejected: "반려",
  final: "전결",
  deferred: "후결 대기",
  post_approved: "후결",
  skipped: "생략",
};

export const STEP_DECISION_COLOR: Record<StepDecision, PillColor> = {
  pending: "neutral",
  approved: "green",
  rejected: "danger",
  final: "primary",
  deferred: "amber",
  post_approved: "blue",
  skipped: "neutral",
};

/** 이 칸이 "승인 계열"인가(문서 진행 판정용) — 전결·후결 확인도 승인으로 센다. */
export function isApprovedDecision(d: StepDecision): boolean {
  return d === "approved" || d === "final" || d === "post_approved";
}

/**
 * 결재선 칸의 직함 라벨 — **조직 직급이 아니라 이 문서에서의 역할**이다.
 * 한 명이면 '승인' 하나, 여럿이면 마지막이 '승인'이고 앞은 '검토'(그룹웨어 관행).
 */
export function stepRoleLabels(count: number): string[] {
  if (count <= 0) return [];
  if (count === 1) return ["승인"];
  return Array.from({ length: count }, (_, i) => (i === count - 1 ? "승인" : "검토"));
}
