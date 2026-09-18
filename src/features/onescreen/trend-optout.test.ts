import { describe, expect, it } from "vitest";
import {
  isTrendOptedOut,
  nextTrendOptOut,
  readTrendOptOut,
  trendOptOutKey,
} from "./trend-optout";
import { buildReportFields } from "./report-fields";

describe("학습 추세 미발송 — 키·읽기·토글", () => {
  it("키는 반·학생 한 쌍이다 — 같은 학생의 다른 반엔 안 번진다", () => {
    expect(trendOptOutKey("c1", "s1")).toBe("c1:s1");
    expect(isTrendOptedOut(["c1:s1"], "c2", "s1")).toBe(false);
  });

  it("🔴 반이 없는 행(수업외 보강)은 키가 없다 — '같은 반'이 성립하지 않는다", () => {
    expect(trendOptOutKey(null, "s1")).toBeNull();
    expect(isTrendOptedOut(["c1:s1"], null, "s1")).toBe(false);
  });

  it("🔴 모양이 어긋난 저장값은 빈 목록(=전부 발송) — 모르는 값을 '미발송'으로 읽지 않는다", () => {
    expect(readTrendOptOut(null)).toEqual([]);
    expect(readTrendOptOut({ onescreen: { trendOptOut: "c1:s1" } })).toEqual([]);
    expect(readTrendOptOut({ onescreen: { trendOptOut: ["c1:s1", 3, "bad"] } })).toEqual(["c1:s1"]);
    // 형제 네임스페이스는 안 읽는다.
    expect(readTrendOptOut({ timetable: { trendOptOut: ["c1:s1"] } })).toEqual([]);
  });

  it("토글은 중복 없이 켜고 끈다", () => {
    expect(nextTrendOptOut([], "c1:s1", true)).toEqual(["c1:s1"]);
    expect(nextTrendOptOut(["c1:s1"], "c1:s1", true)).toEqual(["c1:s1"]);
    expect(nextTrendOptOut(["c1:s1", "c2:s2"], "c1:s1", false)).toEqual(["c2:s2"]);
  });
});

describe("저장·미리보기 공용 필드 — 미발송이면 추세가 빈다", () => {
  const base = {
    subject: undefined,
    homework: "",
    attitude: null,
    tests: { daily: { score: null, max: 20 }, check: { score: null, max: 20 } },
    draft: "",
    showDailyTest: true,
    showCheckTest: true,
  } as unknown as Parameters<typeof buildReportFields>[0];

  it("🔴 초안이 있어도 미발송이면 trendNote가 없다 — 카드가 절을 통째로 숨긴다", () => {
    expect(buildReportFields({ ...base, trendDraft: "최근 상승세" }).trendNote).toBe("최근 상승세");
    expect(buildReportFields({ ...base, trendDraft: "최근 상승세", trendHidden: true }).trendNote).toBeUndefined();
  });
});
