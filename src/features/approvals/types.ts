/**
 * 전자결재 공용 타입·**한글 라벨**. server-only 아님(클라 컴포넌트도 import).
 *
 * 구조는 그룹웨어 표준을 따른다 — 기안 → 결재선 **순차** → 결재대기/상신함/완료함.
 * ⚠️ DB 값(`pending`·`approved`…)을 화면에 그대로 내보내지 않는다 — 매핑은 여기 한 곳.
 */

import type { PillColor } from "@/components/atoms/pill";

/** 결재 양식 — 하이웍스 기본 구성(휴가·품의·지출·업무연락). 추가는 여기 + DB check + 상세 표. */
export const APPROVAL_FORMS = ["leave", "proposal", "expense", "memo"] as const;
export type ApprovalForm = (typeof APPROVAL_FORMS)[number];

export const APPROVAL_FORM_LABEL: Record<ApprovalForm, string> = {
  leave: "휴가신청서",
  proposal: "품의서",
  expense: "지출결의서",
  memo: "업무연락",
};

/** 양식 고르기 화면의 한 줄 설명 — 무엇에 쓰는 문서인지(작성 화면과 목록이 공유). */
export const APPROVAL_FORM_DESC: Record<ApprovalForm, string> = {
  leave: "연차·반차를 신청합니다. 잔여 연차는 입사일 기준 법정 일수에서 자동 계산됩니다.",
  proposal: "구매·계약·행사 등 결정이 필요한 안건을 올려 승인 받습니다.",
  expense: "지출 내역(금액·지출일·분류)을 올려 승인 받습니다.",
  memo: "부서·담당자 간 업무 내용을 공식 문서로 전달합니다.",
};

/** 문서번호 앞머리 — '휴가-2026-0001'. 사람이 부르는 이름이라 판정엔 쓰지 않는다. */
export const APPROVAL_FORM_PREFIX: Record<ApprovalForm, string> = {
  leave: "휴가",
  proposal: "품의",
  expense: "지출",
  memo: "업무",
};

/** 지출결의서 분류 — 기존 /billing 지출과 같은 어휘(실운영 통합 대비). 어휘의 주인은 billing. */
export const EXPENSE_CATEGORIES = ["인건비", "운영비", "매입", "마케팅", "기타"] as const;

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

/** 결재란 한 칸의 판단. */
export const STEP_DECISIONS = ["pending", "approved", "rejected"] as const;
export type StepDecision = (typeof STEP_DECISIONS)[number];

export const STEP_DECISION_LABEL: Record<StepDecision, string> = {
  pending: "대기",
  approved: "승인",
  rejected: "반려",
};

export const STEP_DECISION_COLOR: Record<StepDecision, PillColor> = {
  pending: "neutral",
  approved: "green",
  rejected: "danger",
};

/**
 * 결재선 칸의 직함 라벨 — **조직 직급이 아니라 이 문서에서의 역할**이다.
 * 한 명이면 '승인' 하나, 여럿이면 마지막이 '승인'이고 앞은 '검토'(그룹웨어 관행).
 */
export function stepRoleLabels(count: number): string[] {
  if (count <= 0) return [];
  if (count === 1) return ["승인"];
  return Array.from({ length: count }, (_, i) => (i === count - 1 ? "승인" : "검토"));
}
