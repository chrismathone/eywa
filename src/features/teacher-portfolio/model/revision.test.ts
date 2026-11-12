import { describe, expect, it } from "vitest";
import { DEFAULT_EVALUATION_CONFIG, type EvaluationConfig } from "../evaluation/config";
import { outsideTenure, planRevision, retotal, type StoredMonth } from "./revision";
import type { Metric, PortfolioPeriod } from "./types";

const churn = (raw: number | null, base: number, counted: number, value: number | null): Metric =>
  ({ id: "churn", max: 20, value, raw, base, counted, basis: "", reason: "", detail: [] }) as unknown as Metric;
const report = (raw: number | null, value: number | null): Metric =>
  ({ id: "report", max: 10, value, raw, basis: "", reason: "", detail: [] }) as unknown as Metric;
const manual = (value: number | null): Metric =>
  ({ id: "manual:m1", max: 5, value, raw: value, basis: "", reason: "", detail: [] }) as unknown as Metric;

function period(p: Partial<PortfolioPeriod> & { items: Metric[] }): PortfolioPeriod {
  const out = {
    month: "2026-07", start: "2026-07-01", end: "2026-07-31", partial: false,
    subjects: ["math"], classes: ["A반"], students: 10, knownCount: 0, knownScore: 0, knownMax: 0, total: 0,
    ownReportRecords: 3, holidays: [], dayStats: [], ...p,
  } as PortfolioPeriod;
  retotal(out);
  return out;
}

/** 저장 설정 — 퇴원율 만점을 지금 기본(20)과 다르게 둔다(다시 매길 때 저장 설정을 쓰는지 본다). */
const STORED_CONFIG: EvaluationConfig = {
  ...DEFAULT_EVALUATION_CONFIG,
  metrics: { ...DEFAULT_EVALUATION_CONFIG.metrics, churn: { ...DEFAULT_EVALUATION_CONFIG.metrics.churn, max: 30 } },
};

const plan = (stored: StoredMonth[], before: PortfolioPeriod | undefined, after: PortfolioPeriod | undefined, tenure?: { hireDate: string | null; resignDate: string | null }) =>
  planRevision({ stored, before: () => before, after: () => after, tenure: () => tenure, fallbackConfig: DEFAULT_EVALUATION_CONFIG });

describe("planRevision — 판정이 바꾼 자리만", () => {
  it("옛 판정과 새 판정이 같으면 손대지 않는다", () => {
    const p = period({ items: [churn(5, 20, 1, 16), report(80, 8)] });
    expect(plan([{ teacherId: "t", month: "2026-07", payload: p }], p, structuredClone(p))).toEqual([{ kind: "same", teacherId: "t", month: "2026-07" }]);
  });

  it("퇴원율만 달라지면 퇴원율만 새 값 — 저장 설정으로 다시 매기고, 다른 항목은 저장값 그대로(마감 뒤 자료 변화는 안 들어간다)", () => {
    const storedPayload = period({ items: [churn(11.4, 35, 4, 16), report(70, 7), manual(3)], evaluation: STORED_CONFIG });
    // 지금 자료로 다시 센 옛 판정 — 보고서가 마감 뒤 보충돼 90%가 됐다(판정과 무관한 변화).
    const before = period({ items: [churn(11.4, 35, 4, 8), report(90, 9), manual(4)] });
    const after = period({ items: [churn(15.9, 44, 7, 8), report(90, 9), manual(4)] });
    const [a] = plan([{ teacherId: "t", month: "2026-07", payload: storedPayload }], before, after);
    expect(a!.kind).toBe("revise");
    if (a!.kind !== "revise") return;
    expect(a.changed).toEqual(["churn"]);
    const c = a.payload.items.find((m) => m.id === "churn") as Metric & { base: number; counted: number };
    expect([c.raw, c.base, c.counted, c.max]).toEqual([15.9, 44, 7, 30]);
    expect(c.value).toBeGreaterThan(0);
    expect(a.payload.items.find((m) => m.id === "report")!.raw).toBe(70); // 저장값 그대로
    expect(a.payload.items.find((m) => m.id === "manual:m1")!.value).toBe(3); // 직접 지표 그대로
    expect(a.payload.total).toBe(Math.round(((c.value as number) + 7 + 3) * 10) / 10);
    expect(storedPayload.items[0]!.raw).toBe(11.4); // 원본을 바꾸지 않는다
  });

  it("반·학생 수가 판정으로 달라지면 그 칸도 새 값", () => {
    const stored = period({ items: [churn(0, 10, 0, 20)], classes: ["A반", "B반"], students: 20 });
    const before = period({ items: [churn(0, 10, 0, 20)], classes: ["A반", "B반"], students: 20 });
    const after = period({ items: [churn(0, 10, 0, 20)], classes: ["A반"], students: 12 });
    const [a] = plan([{ teacherId: "t", month: "2026-07", payload: stored }], before, after);
    expect(a!.kind === "revise" && a!.changed).toEqual(["classes", "students"]);
    expect(a!.kind === "revise" && [a!.payload.classes, a!.payload.students]).toEqual([["A반"], 12]);
  });

  it("그 달 전체가 입사 전이면 줄을 지운다 — 새 판정에 활동이 남으면(입사일이 틀렸을 수 있다) 지우지 않고 알린다", () => {
    const stored = period({ items: [churn(16.7, 12, 2, 8)] });
    const idle = period({ items: [churn(null, 0, 0, 0)], classes: [], students: 0, ownReportRecords: 0 });
    expect(plan([{ teacherId: "t", month: "2026-07", payload: stored }], stored, idle, { hireDate: "2026-10-01", resignDate: null })[0])
      .toEqual({ kind: "remove", teacherId: "t", month: "2026-07", reason: "beforeHire" });
    const busy = period({ items: [churn(null, 0, 0, 0)], classes: [], students: 0, ownReportRecords: 2 });
    expect(plan([{ teacherId: "t", month: "2026-07", payload: stored }], stored, busy, { hireDate: "2026-10-01", resignDate: null })[0]!.kind).toBe("skip");
  });

  it("옛 판정·새 판정 어느 하나가 없으면 손대지 않는다", () => {
    const p = period({ items: [churn(0, 10, 0, 20)] });
    expect(plan([{ teacherId: "t", month: "2026-07", payload: p }], undefined, p)[0]).toMatchObject({ kind: "skip", reason: "noBefore" });
    expect(plan([{ teacherId: "t", month: "2026-07", payload: p }], p, undefined)[0]).toMatchObject({ kind: "skip", reason: "noAfter" });
    // 재직 밖 달이어도 새 판정을 못 보면 지우지 않는다(활동이 남았는지 모른다).
    expect(plan([{ teacherId: "t", month: "2026-07", payload: p }], p, undefined, { hireDate: "2026-10-01", resignDate: null })[0])
      .toMatchObject({ kind: "skip", reason: "noAfter" });
  });
});

describe("새로 맡은 선생님의 퇴원율 = 합계에서 제외(원장 2026-11-11)", () => {
  it("판정이 안 바뀐 달도 지난달 담당 학생이 없는 퇴원율(0점)을 합계에서 뺀다", () => {
    const stored = period({ items: [churn(null, 0, 0, 0), report(80, 8)] });
    expect(stored.total).toBe(8);
    const [a] = plan([{ teacherId: "t", month: "2026-07", payload: stored }], structuredClone(stored), structuredClone(stored));
    expect(a!.kind === "revise" && a!.changed).toEqual(["churn:newcomer"]);
    if (a!.kind !== "revise") return;
    const c = a.payload.items.find((m) => m.id === "churn") as Metric & { newcomer?: boolean };
    expect([c.value, c.newcomer]).toEqual([null, true]);
    expect([a.payload.total, a.payload.knownMax]).toEqual([8, 10]);
  });
  it("담당 학생이 있는 퇴원율·이미 표식이 있는 퇴원율은 그대로", () => {
    const p = period({ items: [churn(5, 20, 1, 16)] });
    expect(plan([{ teacherId: "t", month: "2026-07", payload: p }], p, structuredClone(p))[0]!.kind).toBe("same");
  });
});

describe("outsideTenure", () => {
  const july = { start: "2026-07-01", end: "2026-07-31" };
  it("입사가 그 달 안이면 재직 밖이 아니다", () => {
    expect(outsideTenure(july, { hireDate: "2026-07-20", resignDate: null })).toBeNull();
    expect(outsideTenure(july, { hireDate: "2026-08-01", resignDate: null })).toBe("beforeHire");
  });
  it("퇴사일이 그 달 1일 앞이면 퇴사 뒤 · 입사일보다 앞선 옛 퇴사일은 보지 않는다(재입사)", () => {
    expect(outsideTenure(july, { hireDate: null, resignDate: "2026-06-30" })).toBe("afterResign");
    expect(outsideTenure(july, { hireDate: null, resignDate: "2026-07-01" })).toBeNull();
    expect(outsideTenure(july, { hireDate: "2026-01-16", resignDate: "2023-02-28" })).toBeNull();
  });
  it("모르면 자르지 않는다", () => expect(outsideTenure(july, undefined)).toBeNull());
});
