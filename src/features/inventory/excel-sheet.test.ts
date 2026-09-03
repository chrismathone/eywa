import { describe, expect, it } from "vitest";
import {
  ASSET_SHEET_COLUMNS,
  SUPPLY_SHEET_COLUMNS,
  categoryKeyOf,
  duplicateKeyErrors,
  isBlankCells,
  mapHeaders,
  normalizeDate,
  parseAssetSheetRow,
  parseSupplySheetRow,
  statusKeyOf,
} from "./excel-sheet";

describe("엑셀 서식 — 헤더·값 규약", () => {
  it("헤더는 라벨 또는 키를 받고, 공백은 무시한다", () => {
    const m = mapHeaders(["자산ID", " 분류 ", "model", "상태", "모르는열"], ASSET_SHEET_COLUMNS);
    expect(m.get("assetCode")).toBe(0);
    expect(m.get("category")).toBe(1);
    expect(m.get("model")).toBe(2);
    expect(m.get("status")).toBe(3);
    expect(m.size).toBe(4);
  });
  it("날짜 — 여러 표기를 ISO로, 빈 값·미기재는 null, 엉뚱한 값은 undefined", () => {
    expect(normalizeDate("2026-09-02")).toBe("2026-09-02");
    expect(normalizeDate("2026.9.2")).toBe("2026-09-02");
    expect(normalizeDate("2026/09/02")).toBe("2026-09-02");
    expect(normalizeDate("20260902")).toBe("2026-09-02");
    expect(normalizeDate("")).toBeNull();
    expect(normalizeDate("미기재")).toBeNull();
    expect(normalizeDate("—")).toBeNull();
    expect(normalizeDate("상시")).toBeUndefined();
    expect(normalizeDate("2026-13-45")).toBeUndefined();
  });
  it("분류·상태 — 한글 라벨과 키 둘 다 키로, 모르면 undefined", () => {
    expect(categoryKeyOf("노트북")).toBe("laptop");
    expect(categoryKeyOf("laptop")).toBe("laptop");
    expect(categoryKeyOf("TV")).toBe("tv");
    expect(categoryKeyOf("")).toBeNull();
    expect(categoryKeyOf("냉장고")).toBeUndefined();
    expect(statusKeyOf("사용중")).toBe("in_use");
    expect(statusKeyOf("확인 필요")).toBe("check");
    expect(statusKeyOf("")).toBeNull();
    expect(statusKeyOf("고장")).toBeUndefined();
  });
});

describe("자산 행 파싱", () => {
  const base = { assetCode: "nb-019", category: "노트북", status: "사용중", maker: "LG", model: "", acquiredOn: "2026.9.2" };
  it("정상 행 — 코드 대문자화, 빈 칸 null, 상태 기본 사용중", () => {
    const r = parseAssetSheetRow({ ...base, status: "" }, 2);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.row.assetCode).toBe("NB-019");
    expect(r.row.category).toBe("laptop");
    expect(r.row.status).toBe("in_use");
    // 상태 칸을 비웠다는 사실을 남긴다 — 덮어쓰기가 있는 자산을 조용히 사용중으로 바꾸지 않게.
    expect(r.row.statusGiven).toBe(false);
    expect(parseAssetSheetRow(base, 2)).toMatchObject({ ok: true, row: { statusGiven: true } });
    expect(r.row.model).toBeNull();
    expect(r.row.acquiredOn).toBe("2026-09-02");
  });
  it("필수·형식·짝 검사 — 오류 문구에 행 번호", () => {
    expect(parseAssetSheetRow({ ...base, assetCode: "" }, 3)).toMatchObject({ ok: false, error: expect.stringContaining("3행") });
    expect(parseAssetSheetRow({ ...base, category: "" }, 4)).toMatchObject({ ok: false, error: expect.stringContaining("분류") });
    expect(parseAssetSheetRow({ ...base, status: "고장" }, 5)).toMatchObject({ ok: false, error: expect.stringContaining("상태") });
    expect(parseAssetSheetRow({ ...base, disposedOn: "2026-08-28" }, 6)).toMatchObject({ ok: false, error: expect.stringContaining("폐기") });
    expect(parseAssetSheetRow({ ...base, status: "폐기" }, 7)).toMatchObject({ ok: false, error: expect.stringContaining("폐기일") });
    expect(parseAssetSheetRow({ ...base, status: "폐기", disposedOn: "2026-08-28" }, 8)).toMatchObject({ ok: true });
    expect(parseAssetSheetRow({ ...base, acquiredOn: "언젠가" }, 9)).toMatchObject({ ok: false, error: expect.stringContaining("입고일") });
  });
  it("같은 자산ID가 두 번이면 오류", () => {
    const rows = [{ rowNum: 2, k: "NB-001" }, { rowNum: 3, k: "NB-002" }, { rowNum: 4, k: "NB-001" }];
    expect(duplicateKeyErrors(rows, (r) => r.k, "자산ID")).toEqual(['4행: 자산ID "NB-001"가 2행과 겹칩니다']);
  });
  it("빈 행 판정", () => {
    expect(isBlankCells({ a: "", b: "  ", c: undefined })).toBe(true);
    expect(isBlankCells({ a: "", b: "x" })).toBe(false);
  });
});

describe("소모품 행 파싱", () => {
  it("품목ID·품목·수량 필수, 수량은 정수", () => {
    expect(parseSupplySheetRow({ itemCode: "sp-12", name: "마우스", qty: "3", makerModel: "제조사 확인필요" }, 2)).toMatchObject({
      ok: true, row: { itemCode: "SP-12", qty: 3, makerModel: null },
    });
    expect(parseSupplySheetRow({ itemCode: "", name: "마우스", qty: "3" }, 3)).toMatchObject({ ok: false, error: expect.stringContaining("품목ID") });
    expect(parseSupplySheetRow({ itemCode: "SP-1", name: "마우스", qty: "-1" }, 4)).toMatchObject({ ok: false, error: expect.stringContaining("수량") });
    expect(mapHeaders(["품목ID", "품목", "수량"], SUPPLY_SHEET_COLUMNS).size).toBe(3);
  });
});
