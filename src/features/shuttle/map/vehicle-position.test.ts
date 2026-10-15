import { describe, expect, it } from "vitest";
import { ageLabel, ageSeconds, checkReport } from "./vehicle-position";

describe("checkReport", () => {
  const base = { runId: "r1", lat: 35.88, lng: 128.59 };
  it("정상 값은 통과하고 빠진 칸은 null", () => {
    const r = checkReport(base);
    expect(r.ok && r.value).toEqual({ ...base, accuracyM: null, heading: null, speedMps: null, measuredAt: null });
  });
  it("범위 밖·0,0·숫자 아님은 거른다", () => {
    expect(checkReport({ ...base, lat: 91 }).ok).toBe(false);
    expect(checkReport({ ...base, lat: 0, lng: 0 }).ok).toBe(false);
    expect(checkReport({ ...base, lng: Number.NaN }).ok).toBe(false);
    expect(checkReport({ ...base, runId: "" }).ok).toBe(false);
  });
  it("오차가 너무 크면 거른다", () => {
    expect(checkReport({ ...base, accuracyM: 1500 }).ok).toBe(false);
    expect(checkReport({ ...base, accuracyM: 20 }).ok).toBe(true);
  });
  it("방향·속도가 이상하면 null로", () => {
    const r = checkReport({ ...base, heading: 400, speedMps: -1, measuredAt: "nope" });
    expect(r.ok && [r.value.heading, r.value.speedMps, r.value.measuredAt]).toEqual([null, null, null]);
  });
});

describe("age", () => {
  it("초 계산과 문구", () => {
    const now = Date.parse("2026-10-15T07:00:30Z");
    expect(ageSeconds("2026-10-15T07:00:00Z", now)).toBe(30);
    expect(ageSeconds("2026-10-15T07:01:00Z", now)).toBe(0);
    expect(ageLabel(2)).toBe("방금");
    expect(ageLabel(30)).toBe("30초 전");
    expect(ageLabel(130)).toBe("2분 전");
    expect(ageLabel(ageSeconds("x", now))).toBe("알 수 없음");
  });
});
