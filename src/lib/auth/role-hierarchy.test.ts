import { describe, expect, it } from "vitest";
import { canAssignRole, canManageStaff, canManageStaffMember } from "./role-hierarchy";

// 위계 규칙은 권한의 바닥이라 테스트로 못박는다 — 특히 "아래로만 넓힌다"는 불변식.
describe("canManageStaffMember", () => {
  it("원장·관리자는 동급까지 관리한다(2026-07-29 원장 지시)", () => {
    expect(canManageStaffMember("master", "master")).toBe(true);
    expect(canManageStaffMember("admin", "admin")).toBe(true);
  });

  it("아래 직급은 당연히 관리한다", () => {
    expect(canManageStaffMember("master", "teacher")).toBe(true);
    expect(canManageStaffMember("admin", "manager")).toBe(true);
    expect(canManageStaffMember("manager", "teacher")).toBe(true);
  });

  it("🔴 상위는 여전히 불가 — 아래로 향한 권한만 넓혔다(권한 상승 차단)", () => {
    expect(canManageStaffMember("admin", "master")).toBe(false);
    expect(canManageStaffMember("manager", "admin")).toBe(false);
    expect(canManageStaffMember("manager", "master")).toBe(false);
  });

  it("매니저는 동급 개방 대상이 아니다(관리 계열 중 가장 약한 축)", () => {
    expect(canManageStaffMember("manager", "manager")).toBe(false);
  });

  it("직원관리 권한이 없는 역할은 전부 불가", () => {
    for (const actor of ["accountant", "counselor", "teacher", "viewer", "student"] as const) {
      expect(canManageStaff(actor)).toBe(false);
      expect(canManageStaffMember(actor, "teacher")).toBe(false);
      expect(canManageStaffMember(actor, actor)).toBe(false);
    }
  });
});

describe("canAssignRole", () => {
  it("역할 부여는 여전히 '엄격히 아래'만 — 동급 개방과 별개 축(권한 상승 방지)", () => {
    expect(canAssignRole({ actor: "master", targetCurrent: "teacher", newRole: "admin" })).toBe(true);
    expect(canAssignRole({ actor: "admin", targetCurrent: "admin", newRole: "manager" })).toBe(false);
    expect(canAssignRole({ actor: "admin", targetCurrent: "teacher", newRole: "admin" })).toBe(false);
    expect(canAssignRole({ actor: "admin", targetCurrent: "master", newRole: "teacher" })).toBe(false);
  });
});
