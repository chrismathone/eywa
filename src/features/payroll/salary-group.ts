// 과정별 배분율 — 반이 어느 과정(초등/중등/고등/수능/특강)인지 판정하고, 그 반에 적용할 비율을 고른다.
// 순수 함수(Vitest). 원장 확정 2026-07-21: 급여 = 청구 × 0.911 × **과정별 비율**, 반별 수동 override 허용.

/** 급여 과정 5분류(구 출석부와 동일 축). ⚠️ 과목이 아니라 **학년 과정**이다. */
export const SALARY_GROUPS = ["초등", "중등", "고등", "수능", "특강"] as const;
export type SalaryGroup = (typeof SALARY_GROUPS)[number];

export function isSalaryGroup(v: string | null | undefined): v is SalaryGroup {
  return !!v && (SALARY_GROUPS as readonly string[]).includes(v);
}

/** 강사의 과정별 배분율(%) — 미입력 과정은 키 없음. */
export type GroupRates = Partial<Record<SalaryGroup, number>>;

/**
 * 반 이름에서 과정 자동 판정 — **이름에 근거가 있을 때만**.
 * ⚠️ 추정 금지(원장 결정 2026-07-21): 영어 반은 `JP1`·`KW6`·`LS4` 같은 코드명이라 학년 근거가 없다.
 * 학생 학년 최빈값 같은 추정으로 채우지 말 것 — 모르면 null(미분류)로 두고 사람이 지정한다.
 */
export function autoSalaryGroup(className: string | null | undefined): SalaryGroup | null {
  const n = (className ?? "").trim();
  if (!n) return null;
  // ⚠️ 접두어가 아니라 **포함**으로 본다 — "개별(초등M) 초5 BS2C"처럼 과정이 이름 가운데 있는 반이 실재한다
  // (접두어 판정이던 초안에서 이런 반이 통째로 미분류로 빠졌다). 순서는 구체적인 것부터:
  // 특강 > 수능 > 초등 > 중등 > 고등 ("고등M 수능특강"은 특강).
  if (n.includes("특강")) return "특강";
  if (n.includes("수능")) return "수능";
  if (n.includes("초등")) return "초등";
  if (n.includes("중등")) return "중등";
  if (n.includes("고등")) return "고등";
  return null;
}

/** 반 1개에 적용할 비율을 어디서 가져왔는지 — 화면이 근거를 밝히기 위한 값. */
export type RateSource = "class" | "group" | "default" | "unresolved";

export type ResolvedRate = {
  rate: number | null; // null = 정할 수 없음
  group: SalaryGroup | null; // 판정된 과정(수동 우선)
  source: RateSource;
};

/**
 * 반에 적용할 배분율 결정. 우선순위는 **좁은 것부터**:
 *   ① 반별 수동 비율(classRate) → ② 강사의 과정별 비율(groupRates[과정]) → ③ 강사 기본 비율(defaultRate)
 * 과정은 수동 지정(manualGroup)이 이름 자동 판정을 이긴다.
 * ⚠️ 셋 다 없으면 `unresolved` — 0으로 지어내지 않는다(미과금·과소지급 사고 방지).
 */
export function resolveClassRate(input: {
  className?: string | null;
  manualGroup?: string | null;
  classRate?: number | null;
  groupRates?: GroupRates | null;
  defaultRate?: number | null;
}): ResolvedRate {
  const group = isSalaryGroup(input.manualGroup) ? input.manualGroup : autoSalaryGroup(input.className);
  if (input.classRate !== null && input.classRate !== undefined) {
    return { rate: input.classRate, group, source: "class" };
  }
  const byGroup = group ? input.groupRates?.[group] : undefined;
  if (byGroup !== null && byGroup !== undefined) {
    return { rate: byGroup, group, source: "group" };
  }
  if (input.defaultRate !== null && input.defaultRate !== undefined) {
    return { rate: input.defaultRate, group, source: "default" };
  }
  return { rate: null, group, source: "unresolved" };
}

/** jsonb → GroupRates. 모르는 키·범위 밖(0~100 아님)·숫자 아닌 값은 버린다(DB에 뭐가 들어와도 화면이 안 깨지게). */
export function parseGroupRates(raw: unknown): GroupRates {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: GroupRates = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!isSalaryGroup(k)) continue;
    const n = typeof v === "string" ? Number(v) : v;
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 100) continue;
    out[k] = Math.round(n * 100) / 100;
  }
  return out;
}
