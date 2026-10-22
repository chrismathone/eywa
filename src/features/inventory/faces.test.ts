import { describe, expect, it } from "vitest";
import { SUBTABS_BY_MENU, subTabsForMenu } from "@/lib/navigation";
import { INVENTORY_FACE_DEFS, INVENTORY_PATH, inventoryFaces, resolveInventoryTab, tabOfHref } from "./faces";

describe("재고관리 면 전환", () => {
  it("다섯 면 = 자산 · 대여 · 실사 · 소모품 · 업체리스트 (화면 안 탭바 단일 소스)", () => {
    const faces = inventoryFaces();
    expect(faces.map((f) => f.key)).toEqual(["assets", "loans", "audits", "supplies", "vendors"]);
    expect(faces.map((f) => f.label)).toEqual(["자산", "대여", "실사", "소모품", "업체리스트"]);
    expect(faces[0]?.href).toBe(INVENTORY_PATH);
    // href의 ?tab=이 곧 키 — 어긋나면 탭을 눌러도 다른 면이 열린다.
    for (const f of INVENTORY_FACE_DEFS) expect(tabOfHref(f.href)).toBe(f.key);
  });

  it("🔴 사이드바 하부탭엔 넣지 않는다 — 원장 2026-09-02 \"그냥 '재고관리' 1개\"", () => {
    expect(SUBTABS_BY_MENU.inventory).toBeUndefined();
    expect(subTabsForMenu("inventory")).toEqual([]);
  });

  it("건수는 라벨 뒤에 붙고, 모르면(null) 안 붙는다 — 0을 적으면 거짓말", () => {
    const faces = inventoryFaces({ assets: 96, loans: 7, audits: null, supplies: 11, vendors: 4 });
    expect(faces.map((f) => f.label)).toEqual(["자산 96", "대여 7", "실사", "소모품 11", "업체리스트 4"]);
  });

  it("?tab= 해석 — 모르는 값·없음은 자산", () => {
    expect(resolveInventoryTab("loans")).toBe("loans");
    expect(resolveInventoryTab("nope")).toBe("assets");
    expect(resolveInventoryTab(undefined)).toBe("assets");
    expect(tabOfHref("/inventory?tab=supplies")).toBe("supplies");
    expect(tabOfHref("/inventory")).toBe("assets");
  });
});
