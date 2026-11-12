import { describe, expect, it } from "vitest";
import { applyEvaluation, indexEntries } from "../model/evaluate";
import type { Metric, PortfolioPeriod } from "../model/types";
import { BUILTIN_METRICS, DEFAULT_EVALUATION_CONFIG, PORTFOLIO_V1_CONFIG, evaluationConfigSchema, issueMessage, resolveEvaluationConfig, type EvaluationConfig } from "./config";
import { excludedKey, fullKey, previewScore } from "./preview";
import { bandIssues, describeScoring, pointsFor, zeroMaxIssue } from "./scoring";

/** 강사평가 설정(원장 2026-10-13) — 지표마다 켜고 끄기·만점·점수 규칙·자료 없을 때, 직접 만든 지표. */
const clone = (): EvaluationConfig => structuredClone(DEFAULT_EVALUATION_CONFIG);
/** 옛 직원 포트폴리오 구성 — 그 전 점수와 같은지 보는 테스트가 쓴다. */
const v1 = (): EvaluationConfig => structuredClone(PORTFOLIO_V1_CONFIG);

describe("점수 규칙", () => {
  it("비례: 0이면 0점, 만점 기준이면 만점, 밖은 자르고 낮을수록 좋은 지표도 된다", () => {
    expect([pointsFor(50, { mode: "linear", zero: 0, full: 100 }, 20), pointsFor(130, { mode: "linear", zero: 0, full: 100 }, 20)]).toEqual([10, 20]);
    expect([pointsFor(-15, { mode: "linear", zero: -10, full: 10 }, 20), pointsFor(3, { mode: "linear", zero: -10, full: 10 }, 20)]).toEqual([0, 13]);
    // 급여 비율 33% 이하 만점, 60% 이상 0점
    expect([pointsFor(30, { mode: "linear", zero: 60, full: 33 }, 20), pointsFor(70, { mode: "linear", zero: 60, full: 33 }, 20)]).toEqual([20, 0]);
  });
  it("구간: 위에서부터 처음 맞는 구간(양 끝 포함), 어디에도 안 들면 0점", () => {
    const bands = { mode: "bands" as const, bands: [{ from: null, to: 33, points: 20 }, { from: null, to: 40, points: 16 }, { from: 40, to: 60, points: 8 }] };
    expect([pointsFor(33, bands, 20), pointsFor(33.1, bands, 20), pointsFor(60, bands, 20), pointsFor(61, bands, 20)]).toEqual([20, 16, 8, 0]);
  });
  it("건당: 1건에 5점, 상한이 있으면 만점에서 멈춘다", () => {
    expect([pointsFor(3, { mode: "perUnit", points: 5, cap: true }, 10), pointsFor(3, { mode: "perUnit", points: 5, cap: false }, 10)]).toEqual([10, 15]);
  });
  it("규칙을 한글 한 줄로 풀어 쓴다", () => {
    expect(describeScoring({ mode: "bands", bands: [{ from: null, to: 33, points: 20 }, { from: 60, to: null, points: 4 }] }, 20, "%")).toBe("33% 이하 20점 · 60% 이상 4점");
    expect(describeScoring({ mode: "perUnit", points: 5, cap: true }, 20, "건")).toBe("1건당 5점(20점까지)");
  });
});

describe("설정 저장값 해석", () => {
  it("저장값이 없으면 기본값, 깨진 지표 하나는 그 지표만 기본값으로 돌린다", () => {
    expect(resolveEvaluationConfig(null)).toEqual(DEFAULT_EVALUATION_CONFIG);
    const stored = { metrics: { report: { ...DEFAULT_EVALUATION_CONFIG.metrics.report, max: 30 }, follow: { max: "많이" } } };
    const c = resolveEvaluationConfig(stored);
    expect([c.metrics.report.max, c.metrics.follow.max]).toEqual([30, 10]);
  });
  it("저장한 뒤에 더해진 기본 지표는 꺼진 채로 붙는다 — 원장이 맞춘 구성의 만점이 조용히 늘지 않게", () => {
    const stored = { ...structuredClone(PORTFOLIO_V1_CONFIG), metrics: Object.fromEntries(Object.entries(PORTFOLIO_V1_CONFIG.metrics).filter(([id]) => !["payRatio", "churn", "grades", "satisfaction", "punctuality"].includes(id))) };
    const c = resolveEvaluationConfig(stored);
    expect(["payRatio", "churn", "grades", "satisfaction", "punctuality"].map((id) => c.metrics[id as keyof typeof c.metrics].enabled)).toEqual([false, false, false, false, false]);
    expect(Object.values(c.metrics).filter((m) => m.enabled).reduce((n, m) => n + m.max, 0)).toBe(100);
    expect(issueMessage(evaluationConfigSchema.safeParse(stored).error!)).toBe("화면이 오래됐습니다. 새로고침한 뒤 다시 저장해 주세요");
    expect([zeroMaxIssue({ mode: "perUnit", points: 1, cap: false }, 0), zeroMaxIssue({ mode: "linear", zero: 0, full: 100 }, 10)]).toEqual([null, null]);
    expect(zeroMaxIssue({ mode: "linear", zero: 0, full: 100 }, 0)).toContain("늘 0점");
  });
  it("🔴 기본 제공 구성·10-13에 저장한 구성은 그대로 저장된다 — 새 '원생상담'(상담 비율)과 이름이 겹치지 않는다", () => {
    expect(evaluationConfigSchema.safeParse(PORTFOLIO_V1_CONFIG).success).toBe(true);
    expect(evaluationConfigSchema.safeParse(DEFAULT_EVALUATION_CONFIG).success).toBe(true);
    // 10-13 기본값(원생상담 = 후속 처리 follow)으로 저장해 counsel이 없는 구성.
    const stored = structuredClone(DEFAULT_EVALUATION_CONFIG) as unknown as { metrics: Record<string, { label: string; enabled: boolean }> };
    delete stored.metrics.counsel;
    stored.metrics.follow = { ...stored.metrics.follow, label: "원생상담", enabled: true };
    const c = resolveEvaluationConfig(stored);
    expect([c.metrics.follow.label, c.metrics.counsel.label, c.metrics.counsel.enabled]).toEqual(["원생상담", "원생상담(새 항목)", false]);
    expect(evaluationConfigSchema.safeParse(c).success).toBe(true);
  });
  it("차례에서 모르는 지표는 빼고, 빠진 지표는 뒤에 붙인다 — 나중에 더한 기본 지표가 숨지 않게", () => {
    const c = resolveEvaluationConfig({ order: ["coverage", "nope", "report"] });
    expect(c.order.slice(0, 2)).toEqual(["coverage", "report"]);
    expect(c.order).toHaveLength(BUILTIN_METRICS.length);
  });
  it("직접 만든 지표는 키가 겹치면 하나만, 이름이 겹치면 저장을 막는다", () => {
    const m = { key: "sns", label: "SNS 칭찬", unit: "건", description: "", enabled: true, max: 10, scoring: { mode: "perUnit", points: 2, cap: true }, missing: "zero" };
    expect(resolveEvaluationConfig({ manual: [m, m] }).manual).toHaveLength(1);
    const dup = { ...clone(), manual: [{ ...m, label: "수업보고서" }] };
    expect(evaluationConfigSchema.safeParse(dup).success).toBe(false);
  });
});

describe("한 달에 설정 얹기", () => {
  const item = (id: Metric["id"], raw: number | null): Metric => ({ id, max: 0, value: null, raw, basis: "", reason: "", detail: [] } as unknown as Metric);
  const period = (): PortfolioPeriod => ({
    month: "2026-10", start: "2026-10-01", end: "2026-10-12", partial: true, subjects: [], classes: [], students: 1,
    items: [item("report", 50), item("attendance", null), item("follow", 100), item("quality", 4), item("students", 0), item("revenue", 15), item("expansion", 0), item("coverage", null)],
    knownCount: 0, knownScore: 0, knownMax: 0, total: null, ownReportRecords: 0, holidays: [], dayStats: [],
  });
  it("옛 직원 포트폴리오 구성 = 그 전 점수, 자료 없는 출결은 0점 · 보강 할 일 없음은 만점", () => {
    const p = period();
    applyEvaluation(p, PORTFOLIO_V1_CONFIG);
    const shown = p.items.filter((m) => !m.off);
    expect(shown.map((m) => m.value)).toEqual([10, 0, 10, 10, 10, 5, 0, 10]);
    expect([p.total, p.knownMax, shown[1].missing]).toEqual([55, 100, true]);
  });
  it("기본 설정 = 원장 8개 구성(100점) — 아직 계산 전인 지표는 0점, 만족도는 만점 없이 더하고 뺀다, 옛 5개는 꺼 둔다", () => {
    const p = period();
    p.items.push(...(["payRatio", "churn", "grades", "satisfaction", "punctuality"] as const).map((id) => item(id, null)), item("counsel", 100));
    applyEvaluation(p, DEFAULT_EVALUATION_CONFIG);
    const shown = p.items.filter((m) => !m.off);
    // 원생상담 = 담당 학생 상담 비율(counsel, 원장 2026-10-14) — 옛 원생상담(후속 처리, follow)은 꺼 둔다.
    expect(shown.map((m) => [m.id, m.value, m.max])).toEqual([
      ["payRatio", 0, 20], ["churn", 0, 20], ["report", 5, 10], ["counsel", 10, 10], ["grades", 0, 10], ["expansion", 0, 20], ["satisfaction", 0, 0], ["punctuality", 0, 10],
    ]);
    expect([p.total, p.knownMax]).toEqual([15, 100]);
    expect(p.items.filter((m) => m.off).map((m) => m.id)).toEqual(["follow", "attendance", "quality", "students", "revenue", "coverage"]);
    // 만족도는 만점 0 · 상한 없음 — 칭찬 3점이면 총점에 +3(만점 합계는 그대로 100).
    const q = period();
    q.items.push(...(["payRatio", "churn", "grades", "punctuality"] as const).map((id) => item(id, null)), item("satisfaction", 3), item("counsel", 100));
    applyEvaluation(q, DEFAULT_EVALUATION_CONFIG);
    expect([q.items.find((m) => m.id === "satisfaction")?.value, q.knownMax]).toEqual([3, 100]);
  });
  it("🔴 프리랜서 근태는 설정 규칙과 상관없이 만점 — 미리보기도 같게(원장 2026-10-16)", () => {
    const p = period();
    p.items.push({ ...item("punctuality", 7), freelancer: true } as Metric, item("payRatio", null));
    applyEvaluation(p, DEFAULT_EVALUATION_CONFIG);
    const m = p.items.find((x) => x.id === "punctuality")!;
    expect([m.value, m.max, m.missing]).toEqual([10, 10, undefined]);
    expect(previewScore({ punctuality: 7, [fullKey("punctuality")]: 1 }, DEFAULT_EVALUATION_CONFIG).points.punctuality).toBe(10);
    expect(previewScore({ punctuality: 7 }, DEFAULT_EVALUATION_CONFIG).points.punctuality).toBeLessThan(10);
  });
  it("끈 지표·합계에서 뺀 지표는 총점과 만점에서 빠진다 — 만점이 100점이 아니어도 된다", () => {
    const c = v1();
    c.metrics.expansion.enabled = false;
    c.metrics.attendance.missing = "exclude";
    c.metrics.report.max = 30;
    const p = period();
    applyEvaluation(p, c);
    expect([p.total, p.knownMax, p.knownCount]).toEqual([60, 90, 6]);
    expect(p.items.find((m) => m.id === "expansion")?.off).toBe(true);
  });
  it("급여 비율의 새 선생님(지난달 담당 반 없음)은 '자료가 없을 때' 규칙과 상관없이 합계에서 뺀다 — 미리보기도 같게(원장 2026-10-15)", () => {
    const p = period();
    p.items.push({ ...item("payRatio", null), newcomer: true } as Metric, item("churn", null));
    applyEvaluation(p, DEFAULT_EVALUATION_CONFIG);
    expect([p.items.find((m) => m.id === "payRatio")?.value, p.items.find((m) => m.id === "churn")?.value]).toEqual([null, 0]);
    expect(p.items.find((m) => m.id === "payRatio")?.missing).toBe(true);
    const raws = { payRatio: null, [excludedKey("payRatio")]: 1, churn: null };
    expect([previewScore(raws, DEFAULT_EVALUATION_CONFIG).points.payRatio, previewScore(raws, DEFAULT_EVALUATION_CONFIG).points.churn]).toEqual([null, 0]);
    expect(previewScore({ payRatio: null }, DEFAULT_EVALUATION_CONFIG).points.payRatio).toBe(0);
  });
  it("🔴 퇴원율도 지난달 담당 학생이 없으면(새로 맡은 선생님) 합계에서 뺀다 — 담당이 있는데 자료가 없을 때만 설정 규칙(원장 2026-11-11)", () => {
    const p = period();
    p.items.push({ ...item("churn", null), newcomer: true } as Metric);
    applyEvaluation(p, DEFAULT_EVALUATION_CONFIG);
    const churn = p.items.find((m) => m.id === "churn");
    expect([churn?.value, churn?.missing]).toEqual([null, true]);
    expect(p.knownMax).toBe(p.items.filter((m) => !m.off && m.value !== null).reduce((n, m) => n + m.max, 0));
  });
  it("직접 만든 지표는 그 강사·그 달에 넣은 값으로 매기고, 입력이 없으면 '자료가 없을 때' 규칙", () => {
    const c = v1();
    c.manual = [{ key: "sns", label: "SNS 칭찬", unit: "건", description: "", enabled: true, max: 10, scoring: { mode: "perUnit", points: 2, cap: true }, missing: "zero" }];
    c.order = [...c.order, "manual:sns"];
    const entries = indexEntries([{ teacher_id: "t", month: "2026-10", metric_key: "sns", value: "3", note: "디스쿨 후기" }]);
    const p = period();
    applyEvaluation(p, c, entries("t", "2026-10"));
    const sns = p.items.find((m) => m.id === "manual:sns");
    expect([sns?.value, sns?.max, p.knownMax]).toEqual([6, 10, 110]);
    const q = period();
    applyEvaluation(q, c, entries("other", "2026-10"));
    expect([q.items.find((m) => m.id === "manual:sns")?.value, q.items.find((m) => m.id === "manual:sns")?.missing]).toEqual([0, true]);
  });
  it("그 달을 매긴 설정의 사본을 싣는다 — 마감한 달은 그때의 설정으로 굳는다", () => {
    const p = period();
    applyEvaluation(p, DEFAULT_EVALUATION_CONFIG);
    expect(p.evaluation).toEqual(DEFAULT_EVALUATION_CONFIG);
  });
});

describe("점수 규칙의 가장자리(적대적 리뷰 2026-10-13)", () => {
  const bands = { mode: "bands" as const, bands: [{ from: 0, to: 33, points: 20 }, { from: 34, to: 66, points: 10 }, { from: 67, to: 100, points: 5 }] };
  it("구간은 소수 첫째 자리로 반올림한 수치로 견주고, 빈틈은 설정 화면이 알린다", () => {
    expect([pointsFor(33.04, bands, 20), pointsFor(33.66, bands, 20)]).toEqual([20, 0]);
    expect(bandIssues(bands.bands, 20, "%")).toEqual([
      "33%보다 크고 34%보다 작은 값(예: 33.5%)은 어느 구간에도 들지 않아 0점입니다.",
      "66%보다 크고 67%보다 작은 값(예: 66.5%)은 어느 구간에도 들지 않아 0점입니다.",
    ]);
    // 위 끝만 적는 엑셀식 구간(겹침)은 빈틈이 아니다.
    expect(bandIssues([{ from: null, to: 33, points: 20 }, { from: null, to: 40, points: 16 }, { from: null, to: null, points: 4 }], 20, "%")).toEqual([]);
    expect(bandIssues([{ from: 0, to: 33, points: 20 }, { from: 33.1, to: null, points: 10 }], 20, "%")).toEqual([]);
  });
  it("구간 점수는 0~만점, 건당은 상한이면 ±만점까지, 두 기준이 같으면 그 값 이상이 만점", () => {
    expect(pointsFor(10, { mode: "bands", bands: [{ from: null, to: null, points: 30 }] }, 10)).toBe(10);
    expect(bandIssues([{ from: null, to: null, points: 30 }], 10, "%")[0]).toContain("0~10점");
    expect([pointsFor(-4, { mode: "perUnit", points: 5, cap: true }, 10), pointsFor(-4, { mode: "perUnit", points: 5, cap: false }, 10)]).toEqual([-10, -20]);
    expect([pointsFor(60, { mode: "linear", zero: 50, full: 50 }, 10), pointsFor(49.9, { mode: "linear", zero: 50, full: 50 }, 10)]).toEqual([10, 0]);
    expect(describeScoring({ mode: "linear", zero: 50, full: 50 }, 10, "%")).toBe("50% 이상 만점(10점) · 그 아래 0점");
    // 상한 없는 건당도 한 지표 ±10만 점에서 자른다(총점 칸이 넘치면 지점 집계가 통째로 실패) · 규칙 줄은 실제로 매기는 점수로.
    expect(pointsFor(3_000_000, { mode: "perUnit", points: 5, cap: false }, 10)).toBe(100_000);
    expect(describeScoring({ mode: "bands", bands: [{ from: null, to: null, points: 30 }] }, 10, "%")).toBe("전부 10점");
    expect(evaluationConfigSchema.safeParse({ ...clone(), metrics: { ...clone().metrics, report: { ...clone().metrics.report, scoring: { mode: "perUnit", points: 2e6, cap: false } } } }).success).toBe(false);
  });
});
