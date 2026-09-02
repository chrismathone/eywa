/**
 * 대여 이력 상태 — 코드 고정 enum(순수). 색은 tone(의미색 캐논)으로만 고른다.
 */
import type { PillColor } from "@/components/atoms/pill";
import { type SemanticTone, toneColor } from "@/lib/design/semantic-color";

export const LOAN_STATUSES = ["out", "returned", "unreturnable", "check"] as const;
export type LoanStatus = (typeof LOAN_STATUSES)[number];

export const LOAN_STATUS_LABEL: Record<LoanStatus, string> = {
  out: "대여중",
  returned: "반납완료",
  unreturnable: "회수불가",
  check: "확인필요",
};

/** 대여중=진행(info) · 반납완료=끝난 것(inert) · 회수불가=실패(critical) · 확인필요=주의(caution). */
export const LOAN_STATUS_TONE: Record<LoanStatus, SemanticTone> = {
  out: "info",
  returned: "inert",
  unreturnable: "critical",
  check: "caution",
};

export function isLoanStatus(v: unknown): v is LoanStatus {
  return typeof v === "string" && (LOAN_STATUSES as readonly string[]).includes(v);
}

export function loanStatusLabel(status: string | null | undefined): string {
  if (!status) return "";
  return isLoanStatus(status) ? LOAN_STATUS_LABEL[status] : status;
}

export function loanStatusMeta(status: string): { label: string; color: PillColor; tone: SemanticTone } {
  const tone: SemanticTone = isLoanStatus(status) ? LOAN_STATUS_TONE[status] : "inert";
  return { label: loanStatusLabel(status), color: toneColor(tone), tone };
}
