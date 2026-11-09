import { describe, expect, it } from "vitest";
import { relativeScore, tenureBand, type RelativeRow } from "./relative-score";
const row = (id: string, total: number | null, extra: Partial<RelativeRow> = {}): RelativeRow => ({ id, total, recent: total, status: "enrolled", grade: "중2", enrolledMonths: 12, partial: false, ...extra });
const rows = Array.from({ length: 11 }, (_, n) => row(String(n), n * 10));
describe("기여도 상대 위치", () => {
  it("최고·최저·중앙값과 상위 비율의 5등급 경계를 함께 계산한다", () => {
    expect(relativeScore(rows, "10")).toMatchObject({ min: 0, median: 50, max: 100, topPercent: 100 / 11, tier: "1등급", rank: 1, position: 100 });
    expect(relativeScore(rows, "0")).toMatchObject({ topPercent: 100, tier: "5등급", rank: 11, position: 0 });
    const ten = rows.slice(0, 10);
    expect([8, 6, 4, 2, 0].map(n => relativeScore(ten, String(n)).tier)).toEqual(["1등급", "2등급", "3등급", "4등급", "5등급"]);
    expect(relativeScore(ten, "8").topPercent).toBe(20);
    expect(relativeScore(ten, "7").tier).toBe("2등급");
  });
  it("동점은 표시 소수점 기준의 공동 순위와 평균 순위 비율로 처리한다", () => {
    const tied = [0, 20, 30, 50.001, 50.002].map((n, i) => row(String(i), n));
    expect(relativeScore(tied, "3")).toMatchObject({ rank: 1, ties: 2, topPercent: 30, tier: "2등급" });
    expect(relativeScore(tied, "4")).toEqual(relativeScore(tied, "3"));
  });
  it("집계 없음·퇴원생을 0점으로 넣지 않고 확인된 0점과 음수는 포함한다", () => {
    const input = [row("negative", -20), row("zero", 0), row("pending", null), row("exited", 999, { status: "withdrawn" }), row("partial", 10, { partial: true })];
    expect(relativeScore(input, "zero")).toMatchObject({ count: 3, eligible: 4, missing: 1, partial: 1, min: -20, max: 10, rank: 2, tier: null });
    expect(relativeScore(input, "pending").rank).toBeNull();
    expect(relativeScore(input, "exited").rank).toBeNull();
  });
  it("표본 부족·전원 동점·단독 학생에게 상위 등급을 부여하지 않는다", () => {
    expect(relativeScore([row("a", 50)], "a")).toMatchObject({ tier: null, topPercent: null, rank: 1 });
    expect(relativeScore(rows.slice(0, 4), "3").tier).toBeNull();
    expect(relativeScore(rows.map(r => ({ ...r, total: 0 })), "3")).toMatchObject({ tier: null, topPercent: null, ties: 11, position: 50 });
  });
  it("같은 학년·재원기간은 집단을 좁히며 최근 점수는 누적과 별도로 비교한다", () => {
    const input = rows.map((r, n) => ({ ...r, grade: n < 6 ? "중2" : "중3", enrolledMonths: n < 5 ? 3 : 20, recent: 100 - n * 10 }));
    expect(relativeScore(input, "0", "total", "grade").count).toBe(6);
    expect(relativeScore(input, "0", "total", "tenure").count).toBe(5);
    expect(relativeScore(input, "0", "recent")).toMatchObject({ rank: 1, tier: "1등급" });
    expect(relativeScore([row("a", 50, { enrolledMonths: null })], "a", "total", "tenure").rank).toBeNull();
    expect([0, 2, 3, 5, 6, 11, 12, 23, 24, null].map(tenureBand)).toEqual(["0~2개월", "0~2개월", "3~5개월", "3~5개월", "6~11개월", "6~11개월", "12~23개월", "12~23개월", "24개월 이상", null]);
  });
});
