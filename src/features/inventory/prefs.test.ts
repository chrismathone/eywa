import { describe, expect, it } from "vitest";
import { DEFAULT_INVENTORY_PREFS, parseInventoryPrefs } from "./prefs";

describe("재고관리 보기 설정(ui_prefs.inventory)", () => {
  it("빈 값·이상한 값은 기본값(폐기 보임)", () => {
    expect(parseInventoryPrefs(undefined)).toEqual(DEFAULT_INVENTORY_PREFS);
    expect(parseInventoryPrefs("x")).toEqual(DEFAULT_INVENTORY_PREFS);
    expect(parseInventoryPrefs({ hideDisposed: "true" })).toEqual({ hideDisposed: false });
  });
  it("hideDisposed=true만 참으로 읽는다", () => {
    expect(parseInventoryPrefs({ hideDisposed: true })).toEqual({ hideDisposed: true });
  });
});
