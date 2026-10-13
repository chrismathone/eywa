/**
 * 강사평가 설정 — 원장이 지표마다 켜고 끄고, 이름·만점·점수 규칙·자료가 없을 때의 처리를 고친다.
 * 원장 2026-10-13: *"'이것까지 커스터마이징 가능해?' 할 정도로 커스텀 가능하게"* · *"만점이 100점이 아니여도 됨"* ·
 * *"자료 없는 항목은 0점처리"*. 순수 모듈(서버·클라이언트 공용) — 저장·검증·기본값이 모두 여기서 나온다.
 *
 * 🔴 계산 코드는 지표의 **원래 수치**(작성률 %·매출 비중 % …)만 내고, 점수는 이 설정이 정한다(`scoring.ts`).
 *    그래서 설정을 바꾸면 저장된 수치로 바로 미리보기가 되고, 마감한 달은 그때의 설정 사본으로 굳는다.
 * ⚠️ 지표 설정은 **id로 묶은 객체**다 — 배열로 두면 나중에 더한 기본 지표가 저장된 배열에 가려 안 보인다.
 */
import { z } from "zod";

/**
 * 기본 지표 — 차례 = 기본 화면 차례. 앞 8개가 원장 구성(2026-10-13 *"지금 바로 원장 8개 구성으로 바꿔"* · *"디폴트로 해놓고"*),
 * 뒤 5개는 그 전 직원 포트폴리오의 항목(기본은 꺼 둔다 — 계산은 계속하므로 켜면 바로 점수가 선다).
 */
export const BUILTIN_METRICS = [
  "payRatio", "churn", "report", "follow", "grades", "expansion", "satisfaction", "punctuality",
  "attendance", "quality", "students", "revenue", "coverage",
] as const;
export type BuiltinMetricId = (typeof BUILTIN_METRICS)[number];
export type ManualMetricId = `manual:${string}`;

const finite = z.number().finite();
/** 기준·점수 칸 — 총점 칸(numeric(8,1))이 넘치지 않게 범위를 둔다. */
const bounded = finite.min(-1_000_000, "100만 이하로 적어 주세요").max(1_000_000, "100만 이하로 적어 주세요");
/** 구간 — 위에서부터 처음 맞는 구간의 점수. 양 끝 포함, 비우면 끝이 없다. */
export const bandSchema = z.object({ from: bounded.nullable(), to: bounded.nullable(), points: bounded });
export const scoringSchema = z.discriminatedUnion("mode", [
  /** 수치가 `zero`면 0점, `full`이면 만점, 사이는 비례(밖은 0~만점으로 자른다). 낮을수록 좋은 지표는 zero > full. */
  z.object({ mode: z.literal("linear"), zero: bounded, full: bounded }),
  z.object({ mode: z.literal("bands"), bands: z.array(bandSchema).min(1).max(20) }),
  /** 1건(1 단위)마다 점수. `cap`이면 만점에서 멈춘다. */
  z.object({ mode: z.literal("perUnit"), points: bounded, cap: z.boolean() }),
]);
export type Scoring = z.infer<typeof scoringSchema>;
export type Band = z.infer<typeof bandSchema>;

/** 자료가 없을 때 — 0점(원장 기본) · 만점 · 합계에서 빼기(만점에서도 뺀다). */
export const missingSchema = z.enum(["zero", "full", "exclude"]);
export type MissingRule = z.infer<typeof missingSchema>;
export const MISSING_LABEL: Record<MissingRule, string> = { zero: "0점", full: "만점", exclude: "합계에서 빼기" };

const label = z.string().trim().min(1, "이름을 적어 주세요").max(30, "이름은 30자까지입니다");
/** 퇴원율의 세는 법(원장 결정 6) — 뺄 퇴원 사유 코드 · 수강종료(다른 과목은 다님)도 셀지. 이 지표만 쓴다. */
export const churnOptionsSchema = z.object({
  excludeReasons: z.array(z.string().regex(/^[a-z]{1,20}$/)).max(20),
  countEnded: z.boolean(),
});
export type ChurnOptions = z.infer<typeof churnOptionsSchema>;
export const DEFAULT_CHURN_OPTIONS: ChurnOptions = { excludeReasons: ["graduated", "relocation", "illness", "advised"], countEnded: true };
export const metricSettingSchema = z.object({
  enabled: z.boolean(),
  label,
  max: finite.min(0, "만점은 0 이상입니다").max(1000, "만점은 1000점까지입니다"),
  scoring: scoringSchema,
  missing: missingSchema,
  /** 지표만의 세는 법 — 지금은 퇴원율(churn)만. 다른 지표엔 없다. */
  churn: churnOptionsSchema.optional(),
});
export type MetricSetting = z.infer<typeof metricSettingSchema>;

/** 원장이 만드는 지표 — 자동으로 셀 수 없으니 달마다 숫자를 넣는다. */
export const manualMetricSchema = metricSettingSchema.extend({
  key: z.string().regex(/^[a-z0-9]{1,16}$/),
  unit: z.string().trim().max(10, "단위는 10자까지입니다"),
  description: z.string().trim().max(200, "설명은 200자까지입니다"),
});
export type ManualMetricSetting = z.infer<typeof manualMetricSchema>;

export const evaluationConfigSchema = z
  .object({
    version: z.literal(1),
    /** 화면·합계의 차례 — 기본 지표 id와 `manual:<key>`. 빠진 지표는 뒤에 붙는다. */
    order: z.array(z.string().max(40)).max(60),
    metrics: z.object(Object.fromEntries(BUILTIN_METRICS.map((id) => [id, metricSettingSchema])) as Record<BuiltinMetricId, typeof metricSettingSchema>),
    manual: z.array(manualMetricSchema).max(20, "직접 만드는 지표는 20개까지입니다"),
  })
  .superRefine((c, ctx) => {
    const keys = new Set<string>();
    for (const m of c.manual) {
      if (keys.has(m.key)) ctx.addIssue({ code: "custom", message: "같은 지표가 두 번 있습니다", path: ["manual"] });
      keys.add(m.key);
    }
    const labels = [...BUILTIN_METRICS.map((id) => c.metrics[id].label), ...c.manual.map((m) => m.label)];
    if (new Set(labels).size !== labels.length) ctx.addIssue({ code: "custom", message: "지표 이름이 겹칩니다", path: ["metrics"] });
  });
export type EvaluationConfig = z.infer<typeof evaluationConfigSchema>;

const linear = (zero: number, full: number): Scoring => ({ mode: "linear", zero, full });

const upTo = (rows: [number | null, number][]): Scoring => ({ mode: "bands", bands: rows.map(([to, points]) => ({ from: null, to, points })) });

/** 그 전 직원 포트폴리오의 8개 항목(2026-10-13까지) — 그 점수와 똑같이 나온다. 기본 제공 구성 '옛 직원 포트폴리오 구성'. */
const V1_METRICS = {
  attendance: { enabled: true, label: "출결 기록", max: 10, scoring: linear(0, 100), missing: "zero" },
  quality: { enabled: true, label: "직원 평가", max: 10, scoring: linear(0, 4), missing: "zero" },
  students: { enabled: true, label: "학생 배정·유지", max: 20, scoring: linear(-10, 10), missing: "zero" },
  revenue: { enabled: true, label: "매출 기여", max: 10, scoring: linear(0, 30), missing: "zero" },
  // 기한이 이 달에 끝나는 보강이 없으면 만점 — 자료가 없는 게 아니라 할 일이 없었다는 뜻이다.
  coverage: { enabled: true, label: "보강관리", max: 10, scoring: linear(0, 100), missing: "full" },
} satisfies Partial<EvaluationConfig["metrics"]>;

/**
 * 기본값 = **원장 8개 구성**(2026-10-13): 매출 대비 급여 20 · 퇴원율 20 · 보고서 10 · 원생상담 10 · 성적 관리 10 ·
 * 원생 소개 20(1건 5점) · 학부모 만족도(총점에 그대로 더하고 뺀다 — 만점 0) · 강사 근태 10 = 100점.
 * 급여 비율 구간 = 원장 결정 3(≤33% 20 · ≤40% 16 · ≤50% 12 · ≤60% 8 · 그 이상 4). 퇴원율·근태·성적의 구간은 원장이 고칠 자리(처음 값).
 * 아직 계산이 들어오지 않은 지표는 결정 4(자료 없음 = 0점)대로 0점이다 — 들어오는 대로 점수가 선다.
 */
export const DEFAULT_EVALUATION_CONFIG: EvaluationConfig = {
  version: 1,
  order: [...BUILTIN_METRICS],
  metrics: {
    payRatio: { enabled: true, label: "매출 대비 급여", max: 20, scoring: upTo([[33, 20], [40, 16], [50, 12], [60, 8], [null, 4]]), missing: "zero" },
    churn: { enabled: true, label: "퇴원율", max: 20, scoring: upTo([[3, 20], [6, 16], [10, 12], [15, 8], [null, 4]]), missing: "zero", churn: DEFAULT_CHURN_OPTIONS },
    report: { enabled: true, label: "수업보고서", max: 10, scoring: linear(0, 100), missing: "zero" },
    follow: { enabled: true, label: "원생상담", max: 10, scoring: linear(0, 100), missing: "zero" },
    grades: { enabled: true, label: "성적 관리", max: 10, scoring: linear(0, 100), missing: "zero" },
    expansion: { enabled: true, label: "원생 소개", max: 20, scoring: { mode: "perUnit", points: 5, cap: true }, missing: "zero" },
    satisfaction: { enabled: true, label: "학부모 만족도", max: 0, scoring: { mode: "perUnit", points: 1, cap: false }, missing: "zero" },
    punctuality: { enabled: true, label: "강사 근태", max: 10, scoring: linear(5, 0), missing: "zero" },
    ...(Object.fromEntries(Object.entries(V1_METRICS).map(([id, s]) => [id, { ...s, enabled: false }])) as Pick<EvaluationConfig["metrics"], keyof typeof V1_METRICS>),
  },
  manual: [],
};

/** 기본 제공 구성 '옛 직원 포트폴리오 구성' — 2026-10-13 전 점수와 같다(새 지표는 꺼 둔다). */
export const PORTFOLIO_V1_CONFIG: EvaluationConfig = {
  version: 1,
  order: ["report", "attendance", "follow", "quality", "students", "revenue", "expansion", "coverage",
    "payRatio", "churn", "grades", "satisfaction", "punctuality"],
  metrics: {
    ...Object.fromEntries(Object.entries(DEFAULT_EVALUATION_CONFIG.metrics).map(([id, s]) => [id, { ...s, enabled: false }])) as EvaluationConfig["metrics"],
    ...V1_METRICS,
    report: { enabled: true, label: "수업보고서", max: 20, scoring: linear(0, 100), missing: "zero" },
    follow: { enabled: true, label: "원생상담", max: 10, scoring: linear(0, 100), missing: "zero" },
    expansion: { enabled: true, label: "과목 소개", max: 10, scoring: { mode: "perUnit", points: 5, cap: true }, missing: "zero" },
  },
  manual: [],
};

/**
 * 저장된 값을 기본값 위에 얹는다 — 지표마다 통째로 검증해 맞는 것만 쓴다(하나가 깨져도 나머지는 산다).
 * 차례에서 모르는 id는 빼고, 빠진 지표는 기본 차례로 뒤에 붙인다.
 * 🔴 저장값에 **아예 없던** 지표(저장한 뒤에 더해진 기본 지표)는 **꺼진 채로** 붙인다 — 켜진 채로 붙이면 원장이 맞춰 둔 구성에
 *    만점이 조용히 늘어난다(옛 8개로 저장한 설정이 13개·160점이 되는 식, 적대적 리뷰 2026-10-13). 깨진 값만 기본값으로 돌린다.
 *    저장값 자체가 없으면(`metrics`가 없다) 기본값 그대로다.
 */
export function resolveEvaluationConfig(stored: unknown): EvaluationConfig {
  const raw = stored && typeof stored === "object" ? (stored as Record<string, unknown>) : {};
  const hasMetrics = Boolean(raw.metrics && typeof raw.metrics === "object");
  const storedMetrics = hasMetrics ? (raw.metrics as Record<string, unknown>) : {};
  const metrics = Object.fromEntries(BUILTIN_METRICS.map((id) => {
    const parsed = metricSettingSchema.safeParse(storedMetrics[id]);
    if (parsed.success) return [id, parsed.data];
    const fallback = DEFAULT_EVALUATION_CONFIG.metrics[id];
    return [id, hasMetrics && !(id in storedMetrics) ? { ...fallback, enabled: false } : fallback];
  })) as EvaluationConfig["metrics"];
  // 세는 법이 생기기 전에 저장한 퇴원율에는 그 칸이 없다 — 기본값을 채워 설정 화면에 칸이 서게(계산도 같은 기본값).
  if (!metrics.churn.churn) metrics.churn = { ...metrics.churn, churn: DEFAULT_CHURN_OPTIONS };
  const manualRaw = Array.isArray(raw.manual) ? raw.manual : [];
  const seen = new Set<string>();
  const manual = manualRaw.flatMap((m) => {
    const parsed = manualMetricSchema.safeParse(m);
    if (!parsed.success || seen.has(parsed.data.key)) return [];
    seen.add(parsed.data.key);
    return [parsed.data];
  }).slice(0, 20);
  const known = [...BUILTIN_METRICS, ...manual.map((m) => manualId(m.key))] as string[];
  const orderRaw = Array.isArray(raw.order) ? raw.order.filter((x): x is string => typeof x === "string") : [];
  const order = [...new Set(orderRaw.filter((id) => known.includes(id)))];
  for (const id of known) if (!order.includes(id)) order.push(id);
  return { version: 1, order, metrics, manual };
}

export const manualId = (key: string): ManualMetricId => `manual:${key}`;

/** 저장 거절 문구 — 화면이 만든 한글 문구면 그대로, 아니면(지표 칸이 모자란 오래된 화면 등) 새로고침 안내(영문 원문을 띄우지 않는다). */
export function issueMessage(error: z.ZodError): string {
  const message = error.issues[0]?.message ?? "";
  return /[가-힣]/.test(message) ? message : "화면이 오래됐습니다. 새로고침한 뒤 다시 저장해 주세요";
}
export const isManualId = (id: string): id is ManualMetricId => id.startsWith("manual:");
