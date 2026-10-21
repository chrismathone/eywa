/** 표시만 담당한다. 날짜·집계 판정은 onboarding-items의 statusOf/progressOf를 공유한다. */
import type { OnboardingItemStatus } from "./onboarding-items";
import styles from "./cell-display.module.css";

export type OnboardingCellMark = { kind: "check" } | { kind: "text"; text: string };
export function cellMarkOf(status: OnboardingItemStatus, daysLeft: number | null): OnboardingCellMark {
  if (status === "done") return { kind: "check" };
  if (status === "waived") return { kind: "text", text: "제외" };
  if (status === "pending" || daysLeft === null) return { kind: "text", text: "미정" };
  if (status === "overdue") return { kind: "text", text: `D+${Math.abs(daysLeft)}` };
  return { kind: "text", text: daysLeft <= 0 ? "오늘" : `D-${daysLeft}` };
}
export const STATUS_STYLE: Record<OnboardingItemStatus, { box: string; label: string }> = {
  done: { box: styles.done, label: "완료" },
  overdue: { box: styles.overdue, label: "기한 경과" },
  due: { box: styles.due, label: "3일 내 기한" },
  upcoming: { box: styles.neutral, label: "예정" },
  pending: { box: styles.neutral, label: "날짜 미정" },
  waived: { box: styles.waived, label: "기준일 이전 · 관리 제외" },
};
/** 선택 업무는 재촉 색을 쓰지 않는다. 오늘은 임박보다 선명하게 구분한다. */
export function cellBoxClass(status: OnboardingItemStatus, optional: boolean, daysLeft?: number | null): string {
  const tone = optional && status !== "done" ? styles.neutral : status === "due" && daysLeft === 0 ? styles.today : STATUS_STYLE[status].box;
  return `${styles.badge} ${tone}`;
}
