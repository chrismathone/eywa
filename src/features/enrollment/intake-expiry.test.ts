import { describe, expect, it } from "vitest";
import { intakeCutoffMs, intakeExpiryIso, isIntakeExpired } from "./intake-expiry";

describe("intakeExpiryIso (감사 F14)", () => {
  it("고른 날의 KST 23:59:59까지 — 오전 9시에 끊기지 않는다", () => {
    expect(intakeExpiryIso("2026-10-01")).toBe("2026-10-01T14:59:59.000Z");
  });
  it("날짜가 없거나 틀리면 오늘부터 90일째 되는 날의 끝", () => {
    expect(intakeExpiryIso(null, "2026-09-23")).toBe("2026-12-22T14:59:59.000Z");
    expect(intakeExpiryIso("2026-02-30", "2026-09-23")).toBe("2026-12-22T14:59:59.000Z");
  });
});

describe("isIntakeExpired", () => {
  it("만료일 당일 저녁(KST 22시)엔 아직 유효, 다음 날 0시엔 만료", () => {
    const exp = intakeExpiryIso("2026-10-01");
    expect(isIntakeExpired(exp, new Date("2026-10-01T22:00:00+09:00"))).toBe(false);
    expect(isIntakeExpired(exp, new Date("2026-10-02T00:00:00+09:00"))).toBe(true);
  });
  it("만료 없음 = 영구 유효", () => {
    expect(isIntakeExpired(null)).toBe(false);
  });
});

describe("옛 링크(UTC 자정 저장) = 그 날짜 KST 23:59:59까지", () => {
  it("2026-10-01T00:00:00Z 링크는 10/1 오후에도 유효하고 10/2 0시에 끝난다", () => {
    expect(isIntakeExpired("2026-10-01T00:00:00.000Z", new Date("2026-10-01T15:00:00+09:00"))).toBe(false);
    expect(isIntakeExpired("2026-10-01T00:00:00.000Z", new Date("2026-10-02T00:00:01+09:00"))).toBe(true);
  });
  it("새 형식(KST 23:59:59)은 그대로", () => {
    expect(intakeCutoffMs("2026-10-01T14:59:59.000Z")).toBe(new Date("2026-10-01T23:59:59+09:00").getTime());
  });
});
