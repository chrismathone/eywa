import { z } from "zod";
import { rankingConfigSchema } from "./ranking-config";
export const DEFAULT_PARENT_SEMINAR_POINTS = 5;

/** D1/D5: 만점·구간 없이 원래 수치에 현재 건당 배점을 곱한다. */
export const METRICS = ["referralConsult", "referralStarted", "tuitionWon", "subjectMonths", "tenureYears",
  "perfectWeeks", "videoAssignments", "examMonths", "parentPositiveMonths", "teacherPositiveMonths", "parentSeminarEvents"] as const;
export type Metric = (typeof METRICS)[number];
export type Raws = Record<Metric, number>;
export const METRIC_LABELS: Record<Metric, string> = {
  referralConsult: "친구 소개 상담", referralStarted: "친구 소개 수업 시작", tuitionWon: "수업료 기여",
  subjectMonths: "수강 과목·달", tenureYears: "장기 재원", perfectWeeks: "주간 개근", videoAssignments: "영상 숙제 제출",
  examMonths: "월말평가 응시한 달", parentPositiveMonths: "학부모 긍정 신호", teacherPositiveMonths: "선생님 긍정 신호",
  parentSeminarEvents: "학부모 설명회 참석",
};
export const METRIC_GROUPS: Record<Metric, "operations" | "participation"> = {
  referralConsult: "operations", referralStarted: "operations", tuitionWon: "operations", subjectMonths: "operations", tenureYears: "operations",
  perfectWeeks: "participation", videoAssignments: "participation", examMonths: "participation", parentPositiveMonths: "participation", teacherPositiveMonths: "participation",
  parentSeminarEvents: "operations",
};
export const OPERATION_METRICS: readonly Metric[] = METRICS.filter(id => METRIC_GROUPS[id] === "operations");
export const PARTICIPATION_METRICS: readonly Metric[] = METRICS.filter(id => METRIC_GROUPS[id] === "participation");
const rate = z.object({ enabled: z.boolean(), points: z.number().finite().nonnegative() });
export const contributionConfigSchema = z.object({
  version: z.literal(1),
  rates: z.object({ referralConsult: rate, referralStarted: rate, tuitionWon: rate, subjectMonths: rate, tenureYears: rate,
    perfectWeeks: rate.default({ enabled: true, points: 1 }), videoAssignments: rate.default({ enabled: true, points: 1 }),
    examMonths: rate, parentPositiveMonths: rate, teacherPositiveMonths: rate,
    parentSeminarEvents: rate.default({ enabled: false, points: DEFAULT_PARENT_SEMINAR_POINTS }) }),
  referrals: z.object({ months: z.number().int().min(1).max(120), key: z.enum(["studentSubject", "student"]) }),
  attendance: z.object({ allowLate: z.boolean() }),
  ranking: rankingConfigSchema.optional(),
  family: z.object({ enabled: z.boolean(), two: z.number().finite().min(0).max(10000),
    three: z.number().finite().min(0).max(10000), fourPlus: z.number().finite().min(0).max(10000) })
    .refine(v => v.two <= v.three && v.three <= v.fourPlus, "가족 수가 많을수록 배점이 같거나 높아야 합니다.").optional(),
});
export type ContributionConfig = z.infer<typeof contributionConfigSchema>;
export const DEFAULT_CONFIG: ContributionConfig = {
  version: 1,
  family: { enabled: true, two: 100, three: 250, fourPlus: 400 },
  rates: Object.fromEntries(METRICS.map((id) => [id, { enabled: id !== "parentSeminarEvents",
    points: id === "parentSeminarEvents" ? DEFAULT_PARENT_SEMINAR_POINTS : id === "referralConsult" || id === "tenureYears" ? 5 : id === "referralStarted" ? 15 : 1 }])) as ContributionConfig["rates"],
  referrals: { months: 12, key: "studentSubject" }, attendance: { allowLate: true },
};
export const emptyRaws = (): Raws => Object.fromEntries(METRICS.map((id) => [id, 0])) as Raws;
export const isMetric = (value: unknown): value is Metric => typeof value === "string" && METRICS.includes(value as Metric);
/** Old deployment readers still expect these settings. Retire them instead of reinterpreting months as weeks/tasks. */
export const configForStorage = (config: ContributionConfig) => ({ ...config, rates: { ...config.rates,
  perfectMonths: { enabled: false, points: 0 }, videoMonths: { enabled: false, points: 0 } } });
export const resolveConfig = (value: unknown): ContributionConfig => contributionConfigSchema.parse(
  value == null || (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) ? DEFAULT_CONFIG : value);
