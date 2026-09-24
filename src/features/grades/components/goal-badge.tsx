import { GOAL_STATUS_LABEL, type GoalStatus, type GoalView } from "../goals";

const TONE: Record<GoalStatus, string> = {
  achieved: "bg-green-soft text-green",
  missed: "bg-danger-soft text-danger",
  noExam: "bg-bg-soft text-text-dim",
  pending: "bg-bg-soft text-text-dim",
  unknown: "bg-amber-soft text-amber",
};

/**
 * 시험 목표 대비 한 줄 — `목표 90점 / 100점 · 달성`. 학생 상세 목표 구역·기록 행·/exams 성적 현황·학생 추이가 **이 부품 하나**를 쓴다
 * (원장 2026-09-24 *"모든 면에서 일치"*). 목표는 성적 입력 칸의 목표라 단위는 **점**, 환산 숫자는 적지 않는다.
 * 서버·클라 양쪽이 쓴다 — `"use client"`도 `server-only`도 붙이지 말 것.
 */
export function GoalBadge({ goal, className = "" }: { goal: GoalView; className?: string }) {
  const label = GOAL_STATUS_LABEL[goal.status];
  return <span className={`inline-flex items-center gap-1.5 text-xs whitespace-nowrap ${className}`}
    title={goal.status === "unknown" ? "목표나 성적의 만점을 몰라 비교할 수 없습니다" : undefined}>
    <span className="text-text-dim num">목표 {goal.target}점{goal.max != null ? ` / ${goal.max}점` : ""}</span>
    <span className={`rounded-full px-1.5 py-0.5 font-bold ${TONE[goal.status]}`}>{label}</span>
  </span>;
}
