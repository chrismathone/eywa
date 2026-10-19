import { describe, expect, it } from "vitest";
import { markersToClear, picksCover } from "./plan-delete";

describe("picksCover", () => {
  it("요일·교시가 맞아야 한다(자리는 안 본다)", () => {
    expect(picksCover(["mon|17:20|1", "mon|17:20|2", "thu|17:20|1"], "2026-11-02", "17:20")).toBe(true); // 월
    expect(picksCover(["mon|17:20|1"], "2026-11-04", "17:20")).toBe(false); // 수
    expect(picksCover(["mon|17:20|1"], "2026-11-02", "18:20")).toBe(false);
  });
  it("요일 없는 옛 값은 모든 요일 · null은 전부", () => {
    expect(picksCover(["17:20"], "2026-11-04", "17:20")).toBe(true);
    expect(picksCover(null, "2026-11-04", "16:20")).toBe(true);
  });
});

describe("markersToClear — 중등E_중2 심화(원장 2026-10-19)", () => {
  const keys = ["2026-11-02|17:20", "2026-11-02|18:20", "2026-11-04|16:20"];
  const mine = ["mon|17:20|1", "mon|17:20|2", "thu|17:20|1"];
  it("그 배정 칸의 표식만 지운다", () => {
    expect(markersToClear(keys, mine, [])).toEqual(["2026-11-02|17:20"]);
  });
  it("🔴 다른 배정이 같은 칸을 쓰면 남긴다", () => {
    expect(markersToClear(keys, mine, [["mon|17:20"]])).toEqual([]);
    expect(markersToClear(keys, mine, [null])).toEqual([]);
  });
});
