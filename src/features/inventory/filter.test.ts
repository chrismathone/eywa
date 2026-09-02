import { describe, expect, it } from "vitest";
import { assetFilterChips, filterAssets, isAssetFilterKey, matchesTextQuery } from "./filter";
import { computeAssetStats } from "./stats";

const mk = (assetCode: string, status: string, category: string, extra: Partial<Row> = {}): Row => ({
  assetCode, status, category, maker: null, model: null, location: null, holderName: null, note: null, ...extra,
});
type Row = {
  assetCode: string; status: string; category: string; maker: string | null; model: string | null;
  location: string | null; holderName: string | null; note: string | null;
};

describe("자산 필터 칩", () => {
  it("순서는 시안 그대로, 기타는 자산이 있을 때만", () => {
    const labels = assetFilterChips([mk("DT-001", "in_use", "desktop")]).map((c) => c.label);
    expect(labels).toEqual(["전체", "조치필요", "대여중", "사용중", "데스크탑", "노트북", "모니터", "태블릿", "프린터", "TV", "폐기"]);
    expect(assetFilterChips([mk("ET-001", "in_use", "etc")]).map((c) => c.label)).toContain("기타");
  });
  it("키 판정", () => {
    expect(isAssetFilterKey("cat:laptop")).toBe(true);
    expect(isAssetFilterKey("cat:nope")).toBe(false);
    expect(isAssetFilterKey("action")).toBe(true);
  });
});

describe("filterAssets", () => {
  const rows = [
    mk("DT-001", "in_use", "desktop", { model: "A100" }),
    mk("NB-005", "on_loan", "laptop", { holderName: "김태건", model: "LG 15U56" }),
    mk("NB-010", "repair", "laptop", { note: "발열이 너무 심함" }),
    mk("TV-007", "check", "tv", { location: "3층 302" }),
    mk("NB-014", "disposed", "laptop"),
  ];
  it("전체는 폐기까지 전부(표 96행) — 스탯 전체(94)와 다른 게 정상", () => {
    expect(filterAssets(rows, "all", "")).toHaveLength(5);
    expect(computeAssetStats(rows).total).toBe(4);
  });
  it("조치필요 칩 = 스탯 조치필요와 같은 수", () => {
    expect(filterAssets(rows, "action", "")).toHaveLength(computeAssetStats(rows).needsAction);
  });
  it("상태·분류 칩", () => {
    expect(filterAssets(rows, "on_loan", "").map((r) => r.assetCode)).toEqual(["NB-005"]);
    expect(filterAssets(rows, "cat:laptop", "")).toHaveLength(3);
    expect(filterAssets(rows, "disposed", "")).toHaveLength(1);
  });
  it("검색 — 자산ID·모델·위치·사용자·비고, 대소문자·공백 무시", () => {
    expect(filterAssets(rows, "all", "nb-0").map((r) => r.assetCode)).toEqual(["NB-005", "NB-010", "NB-014"]);
    expect(filterAssets(rows, "all", "김태건")).toHaveLength(1);
    expect(filterAssets(rows, "all", "3층302")).toHaveLength(1);
    expect(filterAssets(rows, "all", "발열")).toHaveLength(1);
    expect(filterAssets(rows, "cat:tv", "김태건")).toHaveLength(0);
  });
  it("다른 면 검색도 같은 규칙", () => {
    expect(matchesTextQuery(["L-0031", "김태건", null], "l-00")).toBe(true);
    expect(matchesTextQuery(["L-0031"], "")).toBe(true);
    expect(matchesTextQuery([null], "x")).toBe(false);
  });
});
