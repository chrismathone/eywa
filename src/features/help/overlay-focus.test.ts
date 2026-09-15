import { describe, expect, it } from "vitest";
import { cycleHelpKey, helpKeyForDigit, resolveFocusKey } from "./overlay-focus";

const pills = [
  { key: "b", n: 2 },
  { key: "a", n: 1 },
  { key: "nine", n: 9 },
];

describe("resolveFocusKey", () => {
  it("기본은 보이는 최소 n, 키가 없으면 다시 최소 n, 0개면 null", () => {
    expect(resolveFocusKey(null, pills)).toBe("a");
    expect(resolveFocusKey("b", pills)).toBe("b");
    expect(resolveFocusKey("gone", pills)).toBe("a");
    expect(resolveFocusKey("x", [])).toBeNull();
  });
});

describe("cycleHelpKey", () => {
  it("n 순 키 목록을 순환한다", () => {
    const keys = ["a", "b", "nine"];
    expect(cycleHelpKey(keys, "a", 1)).toBe("b");
    expect(cycleHelpKey(keys, "nine", 1)).toBe("a");
    expect(cycleHelpKey(keys, "a", -1)).toBe("nine");
  });
});

describe("helpKeyForDigit", () => {
  it("1–9만 n으로 점프하고 없으면 null", () => {
    expect(helpKeyForDigit(pills, 9)).toBe("nine");
    expect(helpKeyForDigit(pills, 8)).toBeNull();
    expect(helpKeyForDigit(pills, 10)).toBeNull();
    expect(helpKeyForDigit(pills, 0)).toBeNull();
  });
});
