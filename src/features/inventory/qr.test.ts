import { describe, expect, it } from "vitest";
import { assetDetailPath, assetQrTarget, numberAssets, parseNoRanges, qrImageSrc } from "./qr";

describe("자산 QR 규약", () => {
  it("QR 내용 = 상세 화면 절대 주소(자산ID만 담는다 — 상태는 찍을 때 화면이 보여 준다)", () => {
    expect(assetQrTarget("https://eywa.example.com/", "nb-002")).toBe("https://eywa.example.com/inventory/asset/NB-002");
    expect(assetDetailPath("DT-001")).toBe("/inventory/asset/DT-001");
  });
  it("이미지는 라우트가 그 자리에서 그린다 — 새 자산도 자동", () => {
    expect(qrImageSrc("TV-014")).toBe("/api/inventory/qr/TV-014");
    expect(qrImageSrc("mn-5a")).toBe("/api/inventory/qr/MN-5A");
  });
});

describe("자산 번호(No) · 인쇄 범위", () => {
  it("번호는 마스터 순서로 1부터(표·라벨이 같은 번호)", () => {
    expect(numberAssets([{ id: "a" }, { id: "b" }]).map((r) => r.no)).toEqual([1, 2]);
  });
  it("`1~8, 10~15` · `3` · `1-4 9` 를 번호 집합으로, 빈 문자열은 전체(null)", () => {
    expect([...parseNoRanges("1~8, 10~15", 96).nos!].length).toBe(14);
    expect([...parseNoRanges("3", 96).nos!]).toEqual([3]);
    expect([...parseNoRanges("1-4 9", 96).nos!]).toEqual([1, 2, 3, 4, 9]);
    expect([...parseNoRanges("8~5", 96).nos!]).toEqual([5, 6, 7, 8]);
    expect(parseNoRanges("", 96).nos).toBeNull();
    expect(parseNoRanges("  ", 96).nos).toBeNull();
  });
  it("모양이 틀리거나 범위 밖이면 조용히 무시하지 않고 오류", () => {
    expect(parseNoRanges("a~b", 96).error).toContain("a~b");
    expect(parseNoRanges("0~3", 96).error).toContain("1~96");
    expect(parseNoRanges("90~100", 96).error).toContain("범위");
    expect(parseNoRanges("1~3, x", 96).nos).toBeNull();
  });
});
