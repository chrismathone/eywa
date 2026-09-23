import { describe, expect, it } from "vitest";
import { isStaffInSubjectScope, staffSubjectScopeOf, STAFF_SUBJECT_SCOPES } from "./subject-scope";

const JUNG = "d3e9bcd1-f30e-4f5b-9e78-2ad509f1d06b"; // 정유진
const HEO = "deff8b0b-29cf-461e-8eea-a6196dc2a126"; // 허은진

describe("직원관리 과목 범위", () => {
  it("정유진 = 영어, 허은진 = 수학(+수학 심화)", () => {
    expect(staffSubjectScopeOf(JUNG)).toEqual(["english"]);
    expect(staffSubjectScopeOf(HEO)).toEqual(["math", "subject_1"]);
    expect(Object.keys(STAFF_SUBJECT_SCOPES)).toHaveLength(2);
  });
  it("명단 밖은 범위 없음(전체)", () => {
    expect(staffSubjectScopeOf("someone-else")).toBeNull();
    expect(isStaffInSubjectScope(null, [])).toBe(true);
  });
  it("담당 과목 하나라도 겹치면 보인다 · 과목 없는 직원은 안 보인다", () => {
    const en = staffSubjectScopeOf(JUNG);
    expect(isStaffInSubjectScope(en, ["english"])).toBe(true);
    expect(isStaffInSubjectScope(en, ["math", "english"])).toBe(true);
    expect(isStaffInSubjectScope(en, ["math"])).toBe(false);
    expect(isStaffInSubjectScope(en, [])).toBe(false);
    expect(isStaffInSubjectScope(en, null)).toBe(false);
    expect(isStaffInSubjectScope(staffSubjectScopeOf(HEO), ["subject_1"])).toBe(true);
  });
});
