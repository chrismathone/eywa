import { describe, expect, it } from "vitest";
import { groupOutstandingPeriods, outstandingPeriodLabels, shortPeriod } from "./outstanding-periods";

describe("shortPeriod — 26.08 형식", () => {
  it("YYYY-MM을 짧게", () => {
    expect(shortPeriod("2026-08")).toBe("26.08");
    expect(shortPeriod("2026-12")).toBe("26.12");
  });

  it("형식이 아니면 손대지 않는다", () => {
    expect(shortPeriod("")).toBe("");
    expect(shortPeriod("2026-8")).toBe("2026-8");
  });
});

describe("outstandingPeriodLabels — 몇 월분 미납인가", () => {
  it("2개월 합산이면 두 라벨이 다 붙는다(원장 예시)", () => {
    expect(outstandingPeriodLabels(["2026-09", "2026-08"])).toEqual({
      labels: ["26.08", "26.09"],
      more: 0,
    });
  });

  it("오래된 달부터 — 미수는 옛 달이 더 급하다", () => {
    expect(outstandingPeriodLabels(["2026-04", "2026-03"]).labels).toEqual(["26.03", "26.04"]);
  });

  it("칸이 좁아 두 개까지만, 나머지는 접는다", () => {
    const r = outstandingPeriodLabels(["2026-03", "2026-04", "2026-05", "2026-06"]);
    expect(r.labels).toEqual(["26.03", "26.04"]);
    expect(r.more).toBe(2);
  });

  it("중복은 한 번만", () => {
    expect(outstandingPeriodLabels(["2026-03", "2026-03"])).toEqual({ labels: ["26.03"], more: 0 });
  });

  it("형식이 깨진 값은 라벨에 안 넣는다(화면에 raw 노출 금지)", () => {
    expect(outstandingPeriodLabels(["", "2026-8", "2026-03"])).toEqual({ labels: ["26.03"], more: 0 });
  });

  it("빈 목록이면 아무것도 안 붙는다", () => {
    expect(outstandingPeriodLabels([])).toEqual({ labels: [], more: 0 });
  });
});

describe("groupOutstandingPeriods — 잔액이 남은 달만", () => {
  const row = (p: Record<string, unknown> = {}) => ({
    student_id: "s1",
    period: "2026-03",
    amount_total: 100000,
    amount_discount: 0,
    amount_paid: 0,
    ...p,
  });

  it("학생별로 모은다", () => {
    const m = groupOutstandingPeriods([row(), row({ period: "2026-04" }), row({ student_id: "s2" })]);
    expect(m.get("s1")).toEqual(["2026-03", "2026-04"]);
    expect(m.get("s2")).toEqual(["2026-03"]);
  });

  it("🔴 잔액이 0 이하인 달은 안 센다(카드 금액과 같은 근거)", () => {
    const m = groupOutstandingPeriods([
      row({ amount_paid: 100000 }),
      row({ period: "2026-04", amount_discount: 100000 }),
      row({ period: "2026-05", amount_paid: 40000 }),
    ]);
    expect(m.get("s1")).toEqual(["2026-05"]);
  });

  it("문자열 금액(PostgREST numeric)도 센다", () => {
    const m = groupOutstandingPeriods([row({ amount_total: "50000", amount_paid: "10000" })]);
    expect(m.get("s1")).toEqual(["2026-03"]);
  });

  it("빈 입력이면 빈 맵", () => {
    expect(groupOutstandingPeriods([]).size).toBe(0);
  });
});
