import { describe, expect, it } from "vitest";
import { shoutingKey, shoutingMapOf } from "./shouting";

describe("shoutingKey", () => {
  it("계획 줄과 같은 앵커 모양 — 날짜|HH:MM", () => {
    expect(shoutingKey("2026-08-27", "15:00:00")).toBe("2026-08-27|15:00");
    expect(shoutingKey("2026-08-27", "15:00")).toBe("2026-08-27|15:00");
  });
});

describe("shoutingMapOf", () => {
  it("체크된 것만 담는다(없는 키 = 안 함)", () => {
    const map = shoutingMapOf([
      { flag_date: "2026-08-27", slot_start: "15:00:00", shouting: true },
      { flag_date: "2026-08-27", slot_start: "16:00:00", shouting: false },
      { flag_date: "2026-08-28", slot_start: "15:00:00", shouting: null },
    ]);
    expect(map).toEqual({ "2026-08-27|15:00": true });
  });

  it("timestamptz 모양 날짜도 하루로 자른다", () => {
    expect(shoutingMapOf([{ flag_date: "2026-08-27T00:00:00+09:00", slot_start: "15:00:00", shouting: true }])).toEqual(
      { "2026-08-27|15:00": true },
    );
  });
});
