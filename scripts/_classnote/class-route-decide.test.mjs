import { describe, expect, it } from "vitest";
import { decideRoute, normalizeRouteConfig, pickRouteClass } from "./class-route-decide.mjs";

const r = (over = {}) => ({ subject: "math", teacher_name: "남정화", class_id: "c1", ...over });

describe("normalizeRouteConfig", () => {
  it("모르는 값·빈 설정은 personal(지금 동작 그대로)", () => {
    expect(normalizeRouteConfig(null).route).toBe("personal");
    expect(normalizeRouteConfig({ classnoteMathRoute: "weird" }).route).toBe("personal");
    expect([...normalizeRouteConfig({ classnoteMathRoute: "pilot", classnoteMathRoutePilot: ["a", "", 3] }).pilot]).toEqual(["a"]);
  });
});

describe("decideRoute", () => {
  const cls = normalizeRouteConfig({ classnoteMathRoute: "class" });
  const pilot = normalizeRouteConfig({ classnoteMathRoute: "pilot", classnoteMathRoutePilot: ["남정화"] });
  const personal = normalizeRouteConfig({ classnoteMathRoute: "personal" });
  it("personal이면 언제나 1인 보드", () => expect(decideRoute(personal, r())).toBe("personal"));
  it("class면 수학 반 보고서는 반 보드", () => {
    expect(decideRoute(cls, r())).toBe("class");
    expect(decideRoute(cls, r({ subject: "subject_1" }))).toBe("class");
  });
  it("영어 등 수학이 아니면 설정과 무관하게 1인 보드", () => expect(decideRoute(cls, r({ subject: "english" }))).toBe("personal"));
  it("pilot은 고른 강사(표시 이름 원문 일치)만 반 보드", () => {
    expect(decideRoute(pilot, r())).toBe("class");
    expect(decideRoute(pilot, r({ teacher_name: "이성우" }))).toBe("personal");
    expect(decideRoute(pilot, r({ teacher_name: " 남정화" }))).toBe("personal");
  });
  it("🔴 반 정보가 없으면(보강) 반을 추측하지 않고 needs_class", () => {
    expect(decideRoute(cls, r({ class_id: null }))).toBe("needs_class");
    expect(decideRoute(pilot, r({ class_id: null }))).toBe("needs_class");
  });
});

describe("pickRouteClass — 실제로 올릴 반 보드(원장 2026-09-30)", () => {
  const base = { classId: "c1", sendClassId: null, classEligible: true, sendEligible: false };
  it("personal은 그대로", () => expect(pickRouteClass({ ...base, route: "personal" }).route).toBe("personal"));
  it("보고서 반에 살아 있는 반 보드가 있으면 그 반(종강이어도)", () =>
    expect(pickRouteClass({ ...base, route: "class" })).toEqual({ route: "class", classId: "c1" }));
  it("🔴 보고서 반의 보드가 사라졌으면(종강 뒤 삭제 등) 앱이 정한 보낼 반으로", () =>
    expect(pickRouteClass({ ...base, route: "class", classEligible: false, sendClassId: "c2", sendEligible: true })).toEqual({ route: "class", classId: "c2" }));
  it("반 없는 보강 = 보낼 반", () =>
    expect(pickRouteClass({ route: "needs_class", classId: null, sendClassId: "c2", classEligible: false, sendEligible: true })).toEqual({ route: "class", classId: "c2" }));
  it("둘 다 없으면 기존 1인 보드(1회성 폴백)", () => {
    expect(pickRouteClass({ ...base, route: "class", classEligible: false }).route).toBe("personal");
    expect(pickRouteClass({ route: "needs_class", classId: null, sendClassId: null, classEligible: false, sendEligible: false }).route).toBe("personal");
    // 보낼 반도 사라졌으면 1인 보드
    expect(pickRouteClass({ ...base, route: "class", classEligible: false, sendClassId: "c2", sendEligible: false }).route).toBe("personal");
  });
});
