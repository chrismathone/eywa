import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isStaffInSubjectScope, staffSubjectScopeOf } from "./subject-scope";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf-8");
const EN = "11111111-1111-4111-8111-111111111111";
const MATH = "22222222-2222-4222-8222-222222222222";
const scopes = [
  { userId: EN, subjects: ["english"] },
  { userId: MATH, subjects: ["math", "subject_1"] },
];

describe("직원관리 과목 범위 — 학원 설정에서 지정한다(원장 2026-10-06)", () => {
  it("지정된 사람은 그 과목만", () => {
    expect(staffSubjectScopeOf(EN, scopes)).toEqual(["english"]);
    expect(staffSubjectScopeOf(MATH, scopes)).toEqual(["math", "subject_1"]);
  });

  it("지정되지 않은 사람은 범위 없음(전체)", () => {
    expect(staffSubjectScopeOf("someone-else", scopes)).toBeNull();
    expect(staffSubjectScopeOf(EN, [])).toBeNull();
    expect(isStaffInSubjectScope(null, [])).toBe(true);
  });

  it("🔴 깨진 저장값은 좁은 쪽으로 읽는다 — 그 사람의 줄이 있는데 과목 칸이 깨졌으면 아무도 안 보인다", () => {
    expect(staffSubjectScopeOf(EN, [{ userId: EN, subjects: "english" }])).toEqual([]);
    expect(staffSubjectScopeOf(EN, [{ userId: EN }])).toEqual([]);
    expect(staffSubjectScopeOf(EN, [null, { userId: EN, subjects: ["english", 3] }])).toEqual(["english"]);
    // 목록 자체가 깨졌으면 줄을 찾을 수 없다 — 범위 없음으로 떨어진다(저장 스키마가 이 모양을 받지 않는다).
    expect(staffSubjectScopeOf(EN, null)).toBeNull();
  });

  it("담당 과목 하나라도 겹치면 보인다 · 과목 없는 직원은 안 보인다", () => {
    const en = staffSubjectScopeOf(EN, scopes);
    expect(isStaffInSubjectScope(en, ["english"])).toBe(true);
    expect(isStaffInSubjectScope(en, ["math", "english"])).toBe(true);
    expect(isStaffInSubjectScope(en, ["math"])).toBe(false);
    expect(isStaffInSubjectScope(en, [])).toBe(false);
    expect(isStaffInSubjectScope(en, null)).toBe(false);
    expect(isStaffInSubjectScope(staffSubjectScopeOf(MATH, scopes), ["subject_1"])).toBe(true);
  });

  it("없어진 과목만 남은 범위는 아무와도 안 맞는다(좁은 쪽)", () => {
    expect(isStaffInSubjectScope(["gone"], ["math", "english"])).toBe(false);
    expect(isStaffInSubjectScope([], ["math"])).toBe(false);
  });

  it("서버 판정은 학원 설정의 범위를 읽는다", () => {
    const server = read("src/features/staff/server/subject-scope.ts");
    expect(server).toContain("settings.permissions.specialAccess.staffSubjectScopes");
  });

  it("🔴 원장 역할에는 범위를 걸지 않는다 — 범위 줄이 저장돼 있어도 원장은 전부 본다(원장 2026-10-06)", () => {
    const server = read("src/features/staff/server/subject-scope.ts").replace(/\s+/g, " ");
    expect(server).toContain('if (isSuperAdmin || (me?.id === viewer.id && me.systemRole === "master")) return null;');
  });

  it("🔴 코드에 계정 명단을 두지 않는다 — 지정은 역할·권한 화면에서만", () => {
    const src = read("src/features/staff/subject-scope.ts");
    expect(src).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(src).not.toContain("STAFF_SUBJECT_SCOPES");
  });
});
