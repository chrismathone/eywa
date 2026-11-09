import type { Metric } from "./config";

/**
 * 시안: 로열티 점수(학생 상세와 같은 계산 = 활동 누적 + 가족 가점)를 이루는 점수 칸.
 * 랭킹 표·항목별 1등·상세 '총점 구성'이 이 묶음 하나를 쓴다 — 한 줄의 칸을 더하면 종합 점수와 같다(원장 2026-11-09 *"다 같은 계산에서 온 점수로 통일"*).
 */
export const PART_KEYS = ["tuition", "subject", "tenure", "referral", "participation", "family"] as const;
export type PartKey = (typeof PART_KEYS)[number];
export const PART_LABELS: Record<PartKey, string> = {
  tuition: "수업료 점수", subject: "수강 점수", tenure: "장기재원 점수", referral: "소개 점수", participation: "학습참여 점수", family: "가족 가점",
};
/** 각 칸에 드는 활동 실적(가족 가점은 따로). */
export const PART_METRICS: Record<Exclude<PartKey, "family">, readonly Metric[]> = {
  tuition: ["tuitionWon"], subject: ["subjectMonths"], tenure: ["tenureYears"], referral: ["referralConsult", "referralStarted"],
  participation: ["perfectWeeks", "videoAssignments", "examMonths", "parentPositiveMonths", "teacherPositiveMonths", "parentSeminarEvents"],
};
const round = (n: number) => Math.round(n * 100) / 100;
export function loyaltyParts(points: Record<Metric, number> | null, familyBonus: number | null): Record<PartKey, number | null> {
  const sum = (ids: readonly Metric[]) => (points ? round(ids.reduce((s, id) => s + (points[id] ?? 0), 0)) : null);
  return { tuition: sum(PART_METRICS.tuition), subject: sum(PART_METRICS.subject), tenure: sum(PART_METRICS.tenure),
    referral: sum(PART_METRICS.referral), participation: sum(PART_METRICS.participation), family: familyBonus };
}
