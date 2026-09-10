import { describe, expect, it } from "vitest";
import { JJ_STUDY_MAX_DAYS, ijwStudyDay, isYmd, resolveJjRange } from "./range";

describe("isYmd", () => {
  it("실제로 있는 날짜만", () => {
    expect(isYmd("2026-09-10")).toBe(true);
    expect(isYmd("2026-02-30")).toBe(false);
    expect(isYmd("2026-9-1")).toBe(false);
    expect(isYmd("")).toBe(false);
    expect(isYmd(undefined)).toBe(false);
  });
});

describe("ijwStudyDay — KST 03:00 경계", () => {
  it("02:30 KST는 전날 학습일", () => {
    expect(ijwStudyDay(new Date("2026-09-09T17:30:00Z"))).toBe("2026-09-09"); // = 09-10 02:30 KST
  });
  it("03:30 KST부터 그날", () => {
    expect(ijwStudyDay(new Date("2026-09-09T18:30:00Z"))).toBe("2026-09-10"); // = 09-10 03:30 KST
  });
});

describe("resolveJjRange", () => {
  const today = "2026-09-10";

  it("비면 기본값 — 기본이라는 표시를 단다", () => {
    expect(resolveJjRange({}, { today, defaultDays: 7 })).toEqual({
      from: "2026-09-04",
      to: "2026-09-10",
      isDefault: true,
      endCapped: false,
      clamped: false,
    });
  });

  it("형식이 틀린 날짜는 기본값으로", () => {
    const r = resolveJjRange({ from: "2026-13-01", to: "yesterday" }, { today, defaultDays: 30 });
    expect([r.from, r.to, r.isDefault]).toEqual(["2026-08-12", "2026-09-10", true]);
  });

  it("🔴 시작 > 끝이면 맞바꾼다(지난 두 날짜)", () => {
    const r = resolveJjRange({ from: "2026-09-05", to: "2026-09-01" }, { today, defaultDays: 7 });
    expect([r.from, r.to, r.endCapped]).toEqual(["2026-09-01", "2026-09-05", false]);
  });

  it("🔴 미래 시작 + 빈 끝 — 기본 창으로, '시작이 옮겨졌다'고 적는다(끝날을 옮겼다가 아니다)", () => {
    const r = resolveJjRange({ from: "2026-10-01" }, { today, defaultDays: 7 });
    expect([r.from, r.to, r.startFuture, r.endCapped, r.isDefault]).toEqual([
      "2026-09-04",
      "2026-09-10",
      true,
      false,
      false,
    ]);
  });

  it("🔴 끝이 미래면 상한보다 먼저 오늘로 당긴다 — 시작은 그대로", () => {
    const r = resolveJjRange(
      { from: "2026-01-01", to: "2027-12-31" },
      { today, defaultDays: 7, maxDays: JJ_STUDY_MAX_DAYS },
    );
    expect([r.from, r.to, r.endCapped, r.clamped]).toEqual(["2026-01-01", "2026-09-10", true, false]);
  });

  it("기간 전체가 미래면 기본 창으로 — 시작이 옮겨졌다고 적는다", () => {
    const r = resolveJjRange({ from: "2027-01-01", to: "2027-02-01" }, { today, defaultDays: 7 });
    expect([r.from, r.to, r.startFuture, r.endCapped]).toEqual(["2026-09-04", "2026-09-10", true, false]);
  });

  it("미래 시작 + 지난 끝 — 맞바꾼 사실과 끝을 오늘로 당긴 사실을 둘 다 적는다", () => {
    const r = resolveJjRange({ from: "2026-09-20", to: "2026-09-01" }, { today, defaultDays: 7 });
    expect([r.from, r.to, r.swapped, r.endCapped, r.startFuture]).toEqual([
      "2026-09-01",
      "2026-09-10",
      true,
      true,
      undefined,
    ]);
  });

  it("미래 끝 + 1년 초과 — 끝을 오늘로 당긴 뒤 상한", () => {
    const r = resolveJjRange(
      { from: "2025-01-01", to: "2027-01-01" },
      { today, defaultDays: 7, maxDays: JJ_STUDY_MAX_DAYS },
    );
    expect([r.from, r.to, r.endCapped, r.clamped]).toEqual(["2025-09-11", "2026-09-10", true, true]);
  });

  it("🔴 1년을 넘으면 끝을 지키고 시작을 뒤로 옮긴다", () => {
    const r = resolveJjRange(
      { from: "2025-03-01", to: "2026-09-10" },
      { today, defaultDays: 7, maxDays: JJ_STUDY_MAX_DAYS },
    );
    expect([r.from, r.to, r.clamped]).toEqual(["2025-09-11", "2026-09-10", true]);
  });

  it("딱 1년(365일)은 그대로", () => {
    const r = resolveJjRange(
      { from: "2025-09-11", to: "2026-09-10" },
      { today, defaultDays: 7, maxDays: JJ_STUDY_MAX_DAYS },
    );
    expect(r.clamped).toBe(false);
  });

  it("상한이 없으면(시험) 긴 기간도 그대로", () => {
    const r = resolveJjRange({ from: "2024-01-01", to: "2026-09-10" }, { today, defaultDays: 30 });
    expect([r.from, r.clamped, r.isDefault]).toEqual(["2024-01-01", false, false]);
  });
});
