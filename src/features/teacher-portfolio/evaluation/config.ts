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

export const BUILTIN_METRICS = ["report", "attendance", "follow", "quality", "students", "revenue", "expansion", "coverage"] as const;
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
export const metricSettingSchema = z.object({
  enabled: z.boolean(),
  label,
  max: finite.min(0, "만점은 0 이상입니다").max(1000, "만점은 1000점까지입니다"),
  scoring: scoringSchema,
  missing: missingSchema,
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

/**
 * 기본값 = 지금 직원 포트폴리오와 같은 점수(2026-10-13). 새 지표(매출 대비 급여·퇴원율·소개·만족도·근태·성적)는
 * 단계마다 여기에 더해지고, 다 들어오면 원장이 정한 8개 구성으로 기본값을 바꾼다(계획서 §6).
 */
export const DEFAULT_EVALUATION_CONFIG: EvaluationConfig = {
  version: 1,
  order: [...BUILTIN_METRICS],
  metrics: {
    report: { enabled: true, label: "수업보고서", max: 20, scoring: linear(0, 100), missing: "zero" },
    attendance: { enabled: true, label: "출결 기록", max: 10, scoring: linear(0, 100), missing: "zero" },
    follow: { enabled: true, label: "원생상담", max: 10, scoring: linear(0, 100), missing: "zero" },
    quality: { enabled: true, label: "직원 평가", max: 10, scoring: linear(0, 4), missing: "zero" },
    students: { enabled: true, label: "학생 배정·유지", max: 20, scoring: linear(-10, 10), missing: "zero" },
    revenue: { enabled: true, label: "매출 기여", max: 10, scoring: linear(0, 30), missing: "zero" },
    expansion: { enabled: true, label: "과목 소개", max: 10, scoring: { mode: "perUnit", points: 5, cap: true }, missing: "zero" },
    // 기한이 이 달에 끝나는 보강이 없으면 만점 — 자료가 없는 게 아니라 할 일이 없었다는 뜻이다.
    coverage: { enabled: true, label: "보강관리", max: 10, scoring: linear(0, 100), missing: "full" },
  },
  manual: [],
};

/**
 * 저장된 값을 기본값 위에 얹는다 — 지표마다 통째로 검증해 맞는 것만 쓴다(하나가 깨져도 나머지는 산다).
 * 차례에서 모르는 id는 빼고, 빠진 지표는 기본 차례로 뒤에 붙인다.
 */
export function resolveEvaluationConfig(stored: unknown): EvaluationConfig {
  const raw = stored && typeof stored === "object" ? (stored as Record<string, unknown>) : {};
  const storedMetrics = raw.metrics && typeof raw.metrics === "object" ? (raw.metrics as Record<string, unknown>) : {};
  const metrics = Object.fromEntries(BUILTIN_METRICS.map((id) => {
    const parsed = metricSettingSchema.safeParse(storedMetrics[id]);
    return [id, parsed.success ? parsed.data : DEFAULT_EVALUATION_CONFIG.metrics[id]];
  })) as EvaluationConfig["metrics"];
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
export const isManualId = (id: string): id is ManualMetricId => id.startsWith("manual:");
