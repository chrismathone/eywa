import { describe, expect, it } from "vitest";
import { SUBTABS_BY_MENU } from "@/lib/navigation";
import { INVENTORY_PATH, inventoryFaces, resolveInventoryTab, tabOfHref } from "./faces";

describe("재고 관리 면 전환", () => {
  it("네 면이 사이드바 하부탭에서 파생된다(하드코딩 복제 금지)", () => {
    const subs = SUBTABS_BY_MENU.inventory ?? [];
    const faces = inventoryFaces();
    expect(faces.map((f) => f.key)).toEqual(["assets", "loans", "audits", "supplies"]);
    expect(faces.map((f) => f.label)).toEqual(subs.map((s) => s.label));
    expect(faces.map((f) => f.href)).toEqual(subs.map((s) => s.href));
    expect(faces[0]?.href).toBe(INVENTORY_PATH);
  });

  it("건수는 라벨 뒤에 붙고, 모르면(null) 안 붙는다 — 0을 적으면 거짓말", () => {
    const faces = inventoryFaces({ assets: 96, loans: 7, audits: null, supplies: 11 });
    expect(faces.map((f) => f.label)).toEqual(["자산 96", "대여 7", "실사", "소모품 11"]);
  });

  it("?tab= 해석 — 모르는 값·없음은 자산", () => {
    expect(resolveInventoryTab("loans")).toBe("loans");
    expect(resolveInventoryTab("nope")).toBe("assets");
    expect(resolveInventoryTab(undefined)).toBe("assets");
    expect(tabOfHref("/inventory?tab=supplies")).toBe("supplies");
    expect(tabOfHref("/inventory")).toBe("assets");
  });
});
