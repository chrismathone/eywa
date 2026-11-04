import { describe, expect, it } from "vitest";
import { decideRoute, normalizeRouteConfig, pickRouteClass, ROUTE_BLOCKED_MESSAGE } from "./class-route-decide.mjs";

const r = (over = {}) => ({ subject: "math", teacher_name: "남정화", class_id: "c1", ...over });

describe("normalizeRouteConfig", () => {
  it("모르는 값·빈 설정은 class(2026-11-04 — 1인 보드에 원아를 배정하지 않아 personal은 보낼 곳이 없다 · 앱 기본과 같다)", () => {
    expect(normalizeRouteConfig(null).route).toBe("class");
    expect(normalizeRouteConfig({ classnoteMathRoute: "weird" }).route).toBe("class");
    expect(normalizeRouteConfig({ classnoteMathRoute: "personal" }).route).toBe("personal"); // 저장값은 그대로(화면이 바꾸게 안내)
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

describe("pickRouteClass — 🔴 보고서 반 = 출석부 반 = 발송 반(원장 2026-09-30)", () => {
  it("personal은 그대로", () =>
    expect(pickRouteClass({ route: "personal", classId: "c1", classEligible: true }).route).toBe("personal"));
  it("정규 보고서 = 보고서 반 보드가 살아 있으면 그 반(종강이어도)", () =>
    expect(pickRouteClass({ route: "class", classId: "c1", classEligible: true })).toEqual({ route: "class", classId: "c1", via: "class" }));
  it("🔴 정규 보고서의 반 보드가 사라졌으면 막는다 — 적힌 '보낼 반'·1인 보드로 보내지 않는다(원장 결정 4)", () => {
    expect(pickRouteClass({ route: "class", classId: "c1", classEligible: false, sendClassId: "c2" })).toMatchObject({ route: "blocked", reason: "board_missing" });
    expect(pickRouteClass({ route: "class", classId: "c1", classEligible: false })).toMatchObject({ route: "blocked", reason: "board_missing" });
  });
  it("보강 보고서 = 보강 반 보드가 살아 있으면 그 반", () =>
    expect(pickRouteClass({ route: "needs_class", classId: null, classEligible: false, makeupClassId: "m", makeupEligible: true })).toEqual({ route: "class", classId: "m", via: "makeup" }));
  it("적힌 '보낼 반'이 보강 반과 같으면 그대로", () =>
    expect(pickRouteClass({ route: "needs_class", classId: null, classEligible: false, sendClassId: "m", makeupClassId: "m", makeupEligible: true }).classId).toBe("m"));
  it("🔴 적힌 '보낼 반'이 보강 반과 다르면 막는다(C9 — 예전엔 적힌 값이 이겼다)", () =>
    expect(pickRouteClass({ route: "needs_class", classId: null, classEligible: false, sendClassId: "c2", makeupClassId: "m", makeupEligible: true })).toMatchObject({ route: "blocked", reason: "send_class_differs" }));
  it("🔴 보강 반 보드가 없으면 막는다", () =>
    expect(pickRouteClass({ route: "needs_class", classId: null, classEligible: false, makeupClassId: "m", makeupEligible: false })).toMatchObject({ route: "blocked", reason: "board_missing" }));
  it("🔴 반 미정 보강(보강 반 없음)은 적힌 '보낼 반'이 있어도 막는다 — 반을 추측하지 않는다", () => {
    expect(pickRouteClass({ route: "needs_class", classId: null, classEligible: false, sendClassId: "c2" })).toMatchObject({ route: "blocked", reason: "no_anchor" });
    expect(pickRouteClass({ route: "needs_class", classId: null, classEligible: false })).toMatchObject({ route: "blocked", reason: "no_anchor" });
  });
  it("막힌 사유마다 한국어 문장이 있다", () => {
    for (const k of ["board_missing", "send_class_differs", "no_anchor"]) expect(ROUTE_BLOCKED_MESSAGE[k]).toMatch(/[가-힣]/);
  });
});
