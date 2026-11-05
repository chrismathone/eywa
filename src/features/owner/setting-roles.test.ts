import { describe, expect, it } from "vitest";
import { applySettingRoles, settingRoleSelection } from "./setting-roles";
import { resolveMatrix, type PermissionOverride } from "@/lib/permissions";
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

describe("연결 앱 권한 저장 — 전체·없음만(원장 2026-11-05 · isPermissionLocked와 이중 방어)", () => {
  it("전체·없음은 받고 담당·읽기는 거절한다 — 역할 칸도 개인 칸도", () => {
    const uid = "00000000-0000-4000-8000-000000000001";
    expect(permissionsSchema.safeParse({ overrides: [{ menu: "app_todays_math", role: "teacher", access: "none" }] }).success).toBe(true);
    expect(permissionsSchema.safeParse({ overrides: [{ menu: "app_todays_math", role: "parttime", access: "full" }] }).success).toBe(true);
    for (const access of ["scoped", "readonly"] as const) {
      expect(permissionsSchema.safeParse({ overrides: [{ menu: "app_todays_math", role: "teacher", access }] }).success, access).toBe(false);
      expect(permissionsSchema.safeParse({ overrides: [], userOverrides: [{ userId: uid, menu: "app_todays_math", access }] }).success, access).toBe(false);
    }
  });
});
