import { describe, expect, it } from "vitest";
import type { MonthStat } from "./server/stats-queries";
import { buildSingleYearSeries, buildYearSeries, MONTH_LABELS, yearColor } from "./trend-series";

const m = (month: string, total: number, enrolled = 0): MonthStat => ({
  month,
  total,
  enrolled,
  declined: 0,
  noShow: 0,
  open: 0,
  paidSum: 0,
  rate: total > 0 ? Math.round((enrolled / total) * 100) : null,
});

describe("buildYearSeries — 기간 보기(12칸 × 연도)", () => {
  const months = [m("2025-01", 10, 5), m("2025-03", 30, 9), m("2026-01", 20, 10), m("2026-03", 12, 6)];

  it("가로축은 언제나 1월~12월 12칸", () => {
    const { rows } = buildYearSeries(months);
    expect(rows).toHaveLength(12);
    expect(rows.map((r) => r.label)).toEqual(MONTH_LABELS);
  });

  it("🔴 같은 달이 같은 칸에 선다 — 연도가 달라도", () => {
    const { rows } = buildYearSeries(months);
    expect(rows[0]).toMatchObject({ label: "1월", "2025년 상담": 10, "2026년 상담": 20 });
    expect(rows[2]).toMatchObject({ label: "3월", "2025년 상담": 30, "2026년 상담": 12 });
  });

  it("🔴 값 없는 달은 0이 아니라 **없음** — 0으로 채우면 '그달 0건이었다'는 거짓말이 된다", () => {
    const { rows } = buildYearSeries(months);
    expect(rows[1]!["2025년 상담"]).toBeUndefined(); // 2월은 조회에 아예 없었다
    expect(rows[1]!["2026년 상담"]).toBeUndefined();
  });

  it("계열 = 연도(오름차순), 색은 최신이 가장 진하다", () => {
    const { series } = buildYearSeries(months);
    expect(series.map((s) => s.key)).toEqual(["2025년 상담", "2026년 상담"]);
    expect(series.at(-1)!.color).toBe("var(--color-primary)");
    expect(series[0]!.color).not.toBe(series[1]!.color);
  });

  it("전환율 계열도 연도별로 따로 — 한 줄로 합치면 어느 해 전환율인지 사라진다", () => {
    const { rows, rateSeries } = buildYearSeries(months);
    expect(rateSeries.map((s) => s.key)).toEqual(["2025년 전환율", "2026년 전환율"]);
    expect(rows[0]!["2026년 전환율"]).toBe(50);
  });
});

describe("buildSingleYearSeries — 연도 보기(작년은 선이 아니라 막대)", () => {
  const cur = [m("2026-01", 20, 10), m("2026-02", 30, 6)];
  const prev = [m("2025-01", 12, 4), m("2025-02", 40, 8)];

  it("한 칸에 작년 상담 · 올해 상담 · 올해 등록이 같이 선다", () => {
    const { rows, series } = buildSingleYearSeries(cur, prev, 2026);
    expect(series.map((s) => s.key)).toEqual(["2025년 상담", "2026년 상담", "2026년 등록"]);
    expect(rows[0]).toMatchObject({ label: "1월", "2025년 상담": 12, "2026년 상담": 20, "2026년 등록": 10 });
  });

  it("🔴 전년은 **월 번호로** 맞춘다 — 배열 순서로 짝지으면 시작 달이 밀릴 때 통째로 어긋난다", () => {
    // 올해는 3월부터, 작년은 1월부터 들어온 경우(둘의 배열 인덱스 0이 서로 다른 달이다).
    const { rows } = buildSingleYearSeries([m("2026-03", 7)], [m("2025-01", 99)], 2026);
    expect(rows[2]!["2026년 상담"]).toBe(7); // 3월 칸
    expect(rows[0]!["2025년 상담"]).toBe(99); // 1월 칸 — 3월로 끌려오면 안 된다
    expect(rows[2]!["2025년 상담"]).toBeUndefined();
  });

  it("작년 데이터가 없으면 작년 막대를 아예 만들지 않는다(빈 범례 금지)", () => {
    const { series } = buildSingleYearSeries(cur, [], 2026);
    expect(series.map((s) => s.key)).toEqual(["2026년 상담", "2026년 등록"]);
  });

  it("전환율은 오른쪽 축 계열 하나", () => {
    const { rateSeries, rows } = buildSingleYearSeries(cur, prev, 2026);
    expect(rateSeries.map((s) => s.key)).toEqual(["전환율"]);
    expect(rows[0]!["전환율"]).toBe(50);
    expect(rows[1]!["전환율"]).toBe(20);
  });
});

describe("yearColor", () => {
  it("개수와 무관하게 마지막(최신)이 primary", () => {
    for (const n of [1, 2, 3]) expect(yearColor(n - 1, n), `${n}개년`).toBe("var(--color-primary)");
  });
});
