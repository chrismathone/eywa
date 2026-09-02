import { describe, expect, it } from "vitest";
import { actionNeededAssets, computeAssetStats } from "./stats";

describe("computeAssetStats", () => {
  const rows = [
    { status: "in_use" }, { status: "in_use" }, { status: "on_loan" }, { status: "repair" },
    { status: "lost" }, { status: "check" }, { status: "unregistered" }, { status: "disposed" },
  ];
  it("전체=폐기 제외 · 조치필요=분실·확인·미등록·수리", () => {
    expect(computeAssetStats(rows)).toEqual({ total: 7, inUse: 2, onLoan: 1, needsAction: 4, disposed: 1 });
  });
  it("사용중 + 대여중 + 조치필요 = 전체(비폐기를 정확히 덮고 겹치지 않는다)", () => {
    const s = computeAssetStats(rows);
    expect(s.inUse + s.onLoan + s.needsAction).toBe(s.total);
  });
  it("빈 목록은 전부 0", () => {
    expect(computeAssetStats([])).toEqual({ total: 0, inUse: 0, onLoan: 0, needsAction: 0, disposed: 0 });
  });
  it("조치 목록 길이 = 스탯 조치필요(같은 함수)", () => {
    expect(actionNeededAssets(rows)).toHaveLength(computeAssetStats(rows).needsAction);
  });
});
