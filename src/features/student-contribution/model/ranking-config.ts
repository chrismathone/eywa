import { z } from "zod";

export const RANKING_KEYS = ["tenure", "payment", "family", "seminar", "attendance", "school"] as const;
export type RankingKey = typeof RANKING_KEYS[number];
export const RANKING_LABELS: Record<RankingKey, string> = { tenure: "수강기간", payment: "총 납부액", family: "가족 재원", seminar: "설명회 참석", attendance: "출결 근태", school: "학교 성적" };
const weight = z.number().finite().min(0).max(100);
export const rankingConfigSchema = z.object({
  weights: z.object({ tenure: weight, payment: weight, family: weight, seminar: weight, attendance: weight, school: weight })
    .refine(v => Math.abs(Object.values(v).reduce((s, n) => s + n, 0) - 100) < 0.001, "로열티 랭킹의 배점 합계는 100점이어야 합니다."),
  concurrentBonus: z.number().finite().min(0).max(2),
  extraSubjectBonus: z.number().finite().min(0).max(2),
  gradeMode: z.enum(["improvement", "current", "both"]),
});
export type RankingConfig = z.infer<typeof rankingConfigSchema>;
export const DEFAULT_RANKING_CONFIG: RankingConfig = {
  weights: { tenure: 40, payment: 20, family: 25, seminar: 5, attendance: 5, school: 5 },
  concurrentBonus: 0.25, extraSubjectBonus: 0.25, gradeMode: "both",
};
export const rankingConfig = (config: { ranking?: RankingConfig }) => config.ranking ?? DEFAULT_RANKING_CONFIG;
