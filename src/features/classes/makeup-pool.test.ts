import { describe, expect, it } from "vitest";
import { isMakeupPoolClass, makeupPoolName, MAKEUP_POOL_PREFIX } from "./makeup-pool";

describe("보이지 않는 '보강' 반 — 판정은 컬럼, 이름은 표시용", () => {
  it("이름은 강사명을 붙인다(없으면 접미사 없이)", () => {
    expect(makeupPoolName("김은정")).toBe("보강 · 김은정");
    expect(makeupPoolName("  ")).toBe(MAKEUP_POOL_PREFIX);
    expect(makeupPoolName(null)).toBe(MAKEUP_POOL_PREFIX);
  });

  it("🔴 판정은 컬럼 하나뿐 — 이름이 '보강'이어도 컬럼이 없으면 아니다", () => {
    expect(isMakeupPoolClass({ is_makeup_pool: true })).toBe(true);
    expect(isMakeupPoolClass({ is_makeup_pool: false })).toBe(false);
    // 이름만 같은 진짜 반이 걸려들면 사무실 목록에서 멀쩡한 반이 사라진다.
    expect(isMakeupPoolClass({} as { is_makeup_pool?: boolean })).toBe(false);
    expect(isMakeupPoolClass(null)).toBe(false);
  });

  it("⚠️ 0241a 미적용(컬럼 없음)이면 항상 false — 종전과 같게 돈다", () => {
    expect(isMakeupPoolClass({ is_makeup_pool: undefined })).toBe(false);
  });
});
