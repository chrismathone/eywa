import { describe, expect, it } from "vitest";
import { buildMetrics, type MetricInput } from "./metrics";

const current = { count: 2, gross: 1000, discount: 0, net: 1000, collected: 800, outstanding: 200, students: 2, perStudent: 500 };
const subject = (key: string, label: string) => ({ key, label, color: "blue" }) as MetricInput["subjects"][number];
const base: MetricInput = { month: "2026-07", asOf: "2026-07-31", current, activeStudents: 10, activeCourses: 14, dual: 4, subjects: [subject("math", "수리"), subject("english", "영어회화")], withdrawals: 3, cohort: 20, cohortWithdrawals: 2, reportedFinancials: null, accounting: null };
const ids = (v: MetricInput) => buildMetrics(v).map((m) => m.id);

describe("경영 지표 목록", () => {
  it("동시수강률 라벨은 학원설정 과목 이름 · 영어·수학 과목이 없으면 지표를 내지 않는다", () => {
    expect(buildMetrics(base).find((m) => m.id === "dual_ratio")).toMatchObject({ label: "영어회화·수리 동시수강률", value: 40 });
    expect(ids({ ...base, subjects: [subject("math", "수학"), subject("korean", "국어")] })).not.toContain("dual_ratio");
  });
  it("손익 비율은 값이 있을 때만 카드로 선다", () => {
    expect(ids(base)).not.toEqual(expect.arrayContaining(["operating_margin", "labor_ratio"]));
    const accounting = { margin: 20, laborRatio: 60 } as NonNullable<MetricInput["accounting"]>;
    expect(ids({ ...base, accounting })).toEqual(expect.arrayContaining(["operating_margin", "labor_ratio"]));
  });
  it("퇴원 수·퇴원율은 넘겨받은(퇴원관리 판정) 값 그대로", () => {
    const m = buildMetrics(base);
    expect(m.find((x) => x.id === "withdrawals")?.value).toBe(3);
    expect(m.find((x) => x.id === "withdrawal_rate")?.value).toBe(10);
    expect(buildMetrics({ ...base, cohort: 0 }).find((x) => x.id === "withdrawal_rate")?.value).toBeNull();
    // 퇴원 조회 실패(null)는 0명이 아니라 '자료 필요'
    const failed = buildMetrics({ ...base, withdrawals: null, cohortWithdrawals: null });
    expect(failed.find((x) => x.id === "withdrawals")?.value).toBeNull();
    expect(failed.find((x) => x.id === "withdrawal_rate")?.value).toBeNull();
  });
});
