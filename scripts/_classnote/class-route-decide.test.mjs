import { describe, expect, it } from "vitest";
import { decideRoute, pickRouteClass, ROUTE_BLOCKED_MESSAGE } from "./class-route-decide.mjs";

const r = (over = {}) => ({ subject: "math", teacher_name: "남정화", class_id: "c1", ...over });

describe("decideRoute — 수학은 늘 반 보드(옛 '수학 발송 경로' 설정은 2026-11-05에 걷었다)", () => {
  it("수학 반 보고서는 반 보드 — 작성 강사와 무관", () => {
    expect(decideRoute(r())).toBe("class");
    expect(decideRoute(r({ subject: "subject_1" }))).toBe("class");
    expect(decideRoute(r({ teacher_name: "이성우" }))).toBe("class");
  });
  it("영어 등 수학이 아니면 이 판정과 무관하게 1인 보드 경로(personal)", () => {
    expect(decideRoute(r({ subject: "english" }))).toBe("personal");
    expect(decideRoute(r({ subject: null }))).toBe("personal");
  });
  it("🔴 반 정보가 없으면(보강) 반을 추측하지 않고 needs_class", () => expect(decideRoute(r({ class_id: null }))).toBe("needs_class"));
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
  it("보강 출결 반이 미발송 반이어도 검증된 전달 반을 사용할 수 있다", () =>
    expect(pickRouteClass({ route: "needs_class", classId: null, classEligible: false, sendClassId: "MS", makeupClassId: "JJ", makeupEligible: false, sendEligible: true }))
      .toEqual({ route: "class", classId: "MS", via: "delivery" }));
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
