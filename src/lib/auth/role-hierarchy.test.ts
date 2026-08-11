import { describe, expect, it } from "vitest";
import type { SystemRole } from "@/lib/permissions";
import { canAssignRole, canManageStaff, canManageStaffMember } from "./role-hierarchy";

const ROLES = [
  "master",
  "admin",
  "manager",
  "accountant",
  "counselor",
  "teacher",
  "viewer",
  "student",
] as const satisfies readonly SystemRole[];

// 위계 규칙은 권한의 바닥이라 테스트로 못박는다 — 규칙 = 자신 권한 이하(동급 포함) 전부.
describe("canManageStaffMember", () => {
  it("원장은 전원 관리한다(원장 계정 포함)", () => {
    for (const target of ROLES) expect(canManageStaffMember("master", target)).toBe(true);
  });

  it("동급은 관리한다 — 역할마다 예외 없이(2026-08-11 '자신 권한 이하 전부')", () => {
    for (const actor of ROLES) expect(canManageStaffMember(actor, actor)).toBe(true);
    expect(canManageStaffMember("manager", "manager")).toBe(true); // 종전 false였던 자리
  });

  it("아래 직급은 당연히 관리한다", () => {
    expect(canManageStaffMember("master", "teacher")).toBe(true);
    expect(canManageStaffMember("admin", "manager")).toBe(true);
    expect(canManageStaffMember("manager", "teacher")).toBe(true);
  });

  it("🔴 상위는 불가 — 비번 재설정으로 상위 계정을 탈취하는 권한 상승 경로 차단", () => {
    expect(canManageStaffMember("admin", "master")).toBe(false);
    expect(canManageStaffMember("manager", "admin")).toBe(false);
    expect(canManageStaffMember("manager", "master")).toBe(false);
    expect(canManageStaffMember("teacher", "manager")).toBe(false);
  });

  it("🔴 담당 여부는 이 함수가 아니라 직원관리 메뉴 게이트가 정한다 — 단독 사용 금지", () => {
    // 역할만으로는 강사도 동급(강사)까지 통과한다(의도) — 호출부가 canWriteTenant("staff")와 **함께** 써야 안전.
    expect(canManageStaffMember("teacher", "teacher")).toBe(true);
    // canManageStaff(대시보드·급여용 역할 판정)는 별개 축이며 종전 그대로다.
    for (const actor of ["accountant", "counselor", "teacher", "viewer", "student"] as const) {
      expect(canManageStaff(actor)).toBe(false);
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
