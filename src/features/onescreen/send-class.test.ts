import { describe, expect, it } from "vitest";
import { classRouteAppliesTo, mineOnly, needsSendClass, pickMainClass } from "./send-class";

describe("classRouteAppliesTo — 워커 class-route-decide.mjs와 같은 규칙", () => {
  it("class = 전원 · pilot = 고른 강사(원문 일치)만 · 그 외 = 아니다", () => {
    expect(classRouteAppliesTo({ classnoteMathRoute: "class" }, "누구")).toBe(true);
    expect(classRouteAppliesTo({ classnoteMathRoute: "pilot", classnoteMathRoutePilot: ["남정화"] }, "남정화")).toBe(true);
    expect(classRouteAppliesTo({ classnoteMathRoute: "pilot", classnoteMathRoutePilot: ["남정화"] }, " 남정화")).toBe(false);
    expect(classRouteAppliesTo({ classnoteMathRoute: "personal" }, "남정화")).toBe(false);
    expect(classRouteAppliesTo({}, "남정화")).toBe(false);
  });
});

describe("needsSendClass", () => {
  it("수학 · 반 없음 · 반별 경로일 때만", () => {
    expect(needsSendClass({ subject: "math", classId: null }, true)).toBe(true);
    expect(needsSendClass({ subject: "subject_1" }, true)).toBe(true);
    expect(needsSendClass({ subject: "math", classId: "c1" }, true)).toBe(false);
    expect(needsSendClass({ subject: "english" }, true)).toBe(false);
    expect(needsSendClass({ subject: "math" }, false)).toBe(false);
  });
});

describe("pickMainClass", () => {
  it("후보가 하나면 그 반, 없으면 null", () => {
    expect(pickMainClass(["a"], {}, {})).toBe("a");
    expect(pickMainClass([], {}, {})).toBeNull();
  });
  it("보낸 보고서가 가장 많은 반", () => {
    expect(pickMainClass(["a", "b"], { a: 3, b: 7 }, { a: 99 })).toBe("b");
  });
  it("보고서가 동률이면 출결이 가장 많은 반", () => {
    expect(pickMainClass(["a", "b", "c"], { a: 5, b: 5, c: 1 }, { a: 2, b: 9, c: 50 })).toBe("b");
  });
  it("🔴 그래도 동률이면 정하지 않는다(강사가 고른다)", () => {
    expect(pickMainClass(["a", "b"], { a: 5, b: 5 }, { a: 3, b: 3 })).toBeNull();
    expect(pickMainClass(["a", "b"], {}, {})).toBeNull();
  });
});

describe("mineOnly — 작성 강사 담당 반만(원장 2026-09-29)", () => {
  const cs = [{ id: "a" }, { id: "b" }, { id: "c" }];
  it("강사 = 담당 반만", () => {
    expect(mineOnly(cs, new Set(["b"]), true)).toEqual([{ id: "b" }]);
  });
  it("강사가 담당 반이 없으면 빈 목록(1인 보드로 — 남의 반에 올리지 않는다)", () => {
    expect(mineOnly(cs, new Set(), true)).toEqual([]);
  });
  it("관리자 = 담당 반이 있으면 그 반만, 없으면 전부", () => {
    expect(mineOnly(cs, new Set(["a", "c"]), false)).toEqual([{ id: "a" }, { id: "c" }]);
    expect(mineOnly(cs, new Set(), false)).toEqual(cs);
  });
});
