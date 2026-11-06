import { describe, expect, it } from "vitest";
import { applySettingRoles, settingRoleSelection } from "./setting-roles";
import { MENU_ACCESS, resolveMatrix, type PermissionOverride } from "@/lib/permissions";
import { permissionsSchema } from "./settings-types";
import { SETTINGS_ROLE_GROUPS, type SettingsRoleGroup } from "@/lib/settings-role-catalog";

describe("설정별 역할 변경", () => {
  it("보고서 설정과 AI 멘트를 서로 독립적으로 허용하고 다른 메뉴를 보존한다", () => {
    const original: PermissionOverride[] = [{ menu: "staff", role: "admin", access: "none" }, { menu: "ai_ment", role: "manager", access: "readonly" }];
    const next = applySettingRoles("lesson_reports", original, { report_settings: ["master", "admin"], ai_ment: ["master", "manager"] });
    const matrix = resolveMatrix(next);
    expect(matrix.report_settings.admin).toBe("full");
    expect(matrix.ai_ment.admin).toBe("none");
    expect(matrix.ai_ment.manager).toBe("readonly");
    expect(matrix.staff.admin).toBe("none");
    expect(original).toHaveLength(2);
    expect(permissionsSchema.safeParse({ overrides: next }).success).toBe(true);
  });
  it("원장 잠금과 학생 부여는 적용하지 않는다", () => {
    const matrix = resolveMatrix([
      { menu: "ai_ment", role: "master", access: "none" },
      { menu: "report_settings", role: "student", access: "full" },
    ]);
    expect(matrix.ai_ment.master).toBe("full");
    expect(matrix.report_settings.student).toBe("none");
  });
  it("여러 화면에서 역할을 설정해도 권한 저장 스키마를 넘지 않고 같은 설정을 공유한다", () => {
    let rows: PermissionOverride[] = [];
    for (const group of Object.keys(SETTINGS_ROLE_GROUPS) as SettingsRoleGroup[]) {
      rows = applySettingRoles(group, rows, settingRoleSelection(group, rows));
    }
    expect(permissionsSchema.safeParse({ overrides: rows }).success).toBe(true);
    rows = applySettingRoles("timetable", rows, { operations_settings: ["master", "manager"] });
    expect(settingRoleSelection("owner", rows).operations_settings).toContain("manager");
  });
});

describe("연결 앱 권한 — 전체·없음만(원장 2026-11-05) · 거절은 저장 액션이 요청 값만 보고 한다(permissions-save.test)", () => {
  it("🔴 스키마는 담당·읽기도 읽는다 — 저장된 값을 다시 읽는 데도 쓰여서(운영 설정 보호 검사) 막으면 그 학원은 역할·권한을 저장하지 못한다", () => {
    const uid = "00000000-0000-4000-8000-000000000001";
    for (const access of ["full", "none", "scoped", "readonly"] as const) {
      expect(permissionsSchema.safeParse({ overrides: [{ menu: "app_todays_math", role: "teacher", access }] }).success, access).toBe(true);
      expect(permissionsSchema.safeParse({ overrides: [], userOverrides: [{ userId: uid, menu: "app_todays_math", access }] }).success, access).toBe(true);
    }
  });
  it("저장돼 있던 담당·읽기는 적용하지 않는다 — 그 칸은 코드 기본값 그대로(isPermissionLocked)", () => {
    for (const access of ["scoped", "readonly"] as const) {
      expect(resolveMatrix([{ menu: "app_todays_math", role: "teacher", access }]).app_todays_math.teacher, access).toBe(MENU_ACCESS.app_todays_math.teacher);
      expect(resolveMatrix([{ menu: "app_todays_math", role: "viewer", access }]).app_todays_math.viewer, access).toBe(MENU_ACCESS.app_todays_math.viewer);
    }
  });
});
