/**
 * 학생 메모 분류 — **저장값이 화면에 그대로 새지 않는다**(원장 제보 2026-09-08
 * *"드랍다운 목록과 실제 출력되는게 다름. 실제 출력이 영문으로 출력됨"*).
 */
import { describe, expect, it } from "vitest";
import { MEMO_CATEGORIES, memoCategoryColor, memoCategoryLabel } from "./memo-category";

describe("memoCategoryLabel", () => {
  it("드롭다운에 있는 값은 그 라벨로 나온다", () => {
    for (const c of MEMO_CATEGORIES) expect(memoCategoryLabel(c.value)).toBe(c.label);
  });

  it("🔴 모르는 값·빈 값도 영문이 그대로 새지 않는다", () => {
    expect(memoCategoryLabel("general")).toBe("중점사안");
    expect(memoCategoryLabel("weird_value")).toBe("기타");
    expect(memoCategoryLabel(null)).toBe("중점사안");
    expect(memoCategoryLabel(undefined)).toBe("중점사안");
    expect(memoCategoryLabel("")).toBe("중점사안");
  });

  it("특별반이 목록에 있다(원장 2026-09-08)", () => {
    expect(MEMO_CATEGORIES.map((c) => c.label)).toContain("특별반");
    expect(memoCategoryLabel("special_class")).toBe("특별반");
  });

  it("분류마다 색이 있고, 모르는 값도 색을 잃지 않는다", () => {
    for (const c of MEMO_CATEGORIES) expect(memoCategoryColor(c.value)).toBeTruthy();
    expect(memoCategoryColor("weird_value")).toBe(memoCategoryColor("other"));
  });

  it("⚠️ 저장값은 바꾸지 말 것 — 옛 행이 라벨을 잃는다(값 집합 고정)", () => {
    expect(MEMO_CATEGORIES.map((c) => c.value)).toEqual([
      "general", "homework", "behavior", "parent", "health", "special_class", "other",
    ]);
  });
});
