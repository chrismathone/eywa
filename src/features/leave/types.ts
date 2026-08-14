/**
 * 휴가 신청·전자결재 공용 타입과 **한글 라벨**. server-only 아님(클라 컴포넌트도 import).
 *
 * ⚠️ DB 값(`pending`·`approved`…)을 화면에 그대로 내보내지 않는다 — 라벨 매핑은 여기 한 곳
 *    (프로젝트 규칙: UI에 raw enum 노출 금지). 새 표면이 생기면 이 상수를 쓸 것.
 */

import type { PillColor } from "@/components/atoms/pill";
import type { LeaveKind } from "./request-days";

export const LEAVE_STATUSES = ["pending", "approved", "rejected", "canceled"] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

export const LEAVE_KIND_LABEL: Record<LeaveKind, string> = {
  annual: "연차",
  half: "반차",
};

/** 결재자 1인의 판단(결재선 한 칸). */
export const LEAVE_DECISIONS = ["pending", "approved", "rejected"] as const;
export type LeaveDecision = (typeof LEAVE_DECISIONS)[number];

export const LEAVE_DECISION_LABEL: Record<LeaveDecision, string> = {
  pending: "대기",
  approved: "승인",
  rejected: "반려",
};

export const LEAVE_DECISION_COLOR: Record<LeaveDecision, PillColor> = {
  pending: "neutral",
  approved: "green",
  rejected: "danger",
};

/**
 * 신청 1건의 상태 라벨. 색은 Pill 팔레트.
 * ⚠️ '자동반려'는 없다 — 잔여를 넘는 신청은 행이 만들어지기 전에 거절되므로(원장 2026-08-14),
 *    여기 '반려'는 **사람이 결재선에서 반려한 것**뿐이다.
 */
export function leaveStatusLabel(status: LeaveStatus): { label: string; color: PillColor } {
  if (status === "approved") return { label: "승인", color: "green" };
  if (status === "rejected") return { label: "반려", color: "danger" };
  if (status === "canceled") return { label: "취소", color: "neutral" };
  return { label: "결재 대기", color: "blue" };
}
