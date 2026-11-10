import { describe, expect, it } from "vitest";
import { MENU_KEYS, SYSTEM_ROLES } from "@/lib/permissions";
import { DEFAULT_SETTINGS } from "@/features/owner/defaults";
import { resolveSettings } from "@/features/owner/resolve";
import { dashboardAssignmentSchema } from "@/features/owner/settings-types";
import { dashboardAssignmentOf } from "./assignment";
import { dashboardMembers, type MemberRow } from "./members";
import { normalizeDashboard } from "./normalize";
import { DASHBOARD_ROLES, ROLE_BUNDLE } from "./roles";
import { EMPTY_DASHBOARD, type DashboardAssignment } from "./types";
import { resolveView } from "./view";

const id = "11111111-1111-4111-8111-111111111111";
const user = { id, systemRole: "admin" as const, isSuperAdmin: false, subjects: ["math"] };
const assignment: DashboardAssignment = { userId: id, scope: "subjects", subjects: ["english"], adminLayout: "desk" };

describe("역할·담당 범위·배치는 독립", () => {
  it("9개 시스템 역할 + 총괄 자격을 모두 선택한다", () => {
    expect(DASHBOARD_ROLES).toEqual(["super", ...SYSTEM_ROLES]);
    expect(new Set(SYSTEM_ROLES.map((r) => ROLE_BUNDLE[r])).size).toBe(9);
  });
  it("담당 과목이 있어도 경영지원형을 고를 수 있고, 전 과목도 과목 운영형을 고를 수 있다", () => {
    expect(dashboardAssignmentOf(user, assignment)).toMatchObject({ bundle: "desk", subjects: ["english"], subjectScoped: true });
    expect(dashboardAssignmentOf(user, { ...assignment, scope: "all", adminLayout: "subject" })).toMatchObject({ bundle: "subject", subjects: [], subjectScoped: false });
  });
  it("미지정이면 전 과목으로 넓히지 않고 공지만 읽는다", () => {
    const view = dashboardAssignmentOf(user, { ...assignment, scope: "unassigned" });
    expect(view.subjects).toEqual([]);
    const resolved = resolveView({ stored: EMPTY_DASHBOARD, bundle: view.bundle, subjectScoped: view.subjectScoped, menus: new Set(MENU_KEYS) });
    expect(resolved.items?.map((i) => i.id)).toEqual(["panel:notices"]);
    expect(resolved.scopeLabel).toBe("담당 범위 미지정");
  });
  it("명시 지정 전에는 기존 직원의 범위를 그대로 유지한다", () => {
    expect(dashboardAssignmentOf(user)).toMatchObject({ bundle: "subject", subjects: ["math"], inherited: true });
    expect(dashboardAssignmentOf({ ...user, subjects: [] })).toMatchObject({ bundle: "desk", subjectScoped: false });
  });
  it("총괄·원장 범위는 개인 지정으로 좁혀지지 않는다", () => {
    expect(dashboardAssignmentOf({ ...user, isSuperAdmin: true }, assignment)).toMatchObject({ bundle: "super", scope: "all" });
    expect(dashboardAssignmentOf({ ...user, systemRole: "master" }, assignment)).toMatchObject({ bundle: "owner", scope: "all" });
  });
  it("별도 자격이 있는 원장도 저장된 원장 배치와 이후 변경을 그대로 따른다", () => {
    const account = { ...user, systemRole: "master" as const, isSuperAdmin: true };
    const view = dashboardAssignmentOf(account, assignment);
    expect(view).toMatchObject({ bundle: "owner", scope: "all", subjectScoped: false, subjects: [] });
    for (const w of [3, 6]) {
      const items = [{ id: "kpi:students", x: 0, y: 0, w, h: 2, title: "재원생 현황" }];
      const stored = { ...EMPTY_DASHBOARD, layouts: [{ role: "owner" as const, items }] };
      const actual = resolveView({ stored, bundle: view.bundle, menus: new Set(MENU_KEYS) });
      expect(actual.items).toEqual(items);
      expect(actual.rev).toBe(resolveView({ stored, bundle: "owner", menus: new Set(MENU_KEYS) }).rev);
    }
    const member: MemberRow = { id, display_name: "원장", system_role: "master", subjects: [], status: "active" };
    expect(dashboardMembers([member], new Set([id]), DEFAULT_SETTINGS)[0]).toMatchObject({ bundle: "owner", scopeLabel: "전 과목", canOpen: true });
  });
});

describe("기존 설정 호환·실제 배정 직원", () => {
  it("그 밖 역할의 저장 배치를 상담·회계·열람으로 복사하되 이미 분리한 배치는 보존한다", () => {
    const a = [{ id: "panel:notices", w: 12, h: 1 }];
    const b = [{ id: "panel:billingMonth", w: 6, h: 1 }];
    const settings = normalizeDashboard({ version: 1, layouts: [{ role: "other", items: a }, { role: "accountant", items: b }], assignments: [assignment] });
    // 옛 배치는 읽을 때 새 대시보드 모양으로 옮겨진다(카드는 그대로 — `board.ts`).
    expect(settings.layouts.map((l) => [l.role, l.items.filter((i) => i.id.startsWith("panel:")).map((i) => i.id)])).toEqual([["counselor", ["panel:notices"]], ["accountant", ["panel:billingMonth"]], ["viewer", ["panel:notices"]]]);
    expect(settings.assignments).toEqual([assignment]);
    expect(resolveSettings({ dashboard: settings }, { name: "학원" }).dashboard).toEqual(settings);
  });
  it("과목 선택 상태의 빈 과목은 저장할 수 없다", () => {
    expect(dashboardAssignmentSchema.safeParse({ ...assignment, subjects: [] }).success).toBe(false);
  });
  const row: MemberRow = { id, display_name: "직원", system_role: "admin", subjects: ["math"], status: "active" };
  it("개인별 대시보드 금지와 명시 배정을 같은 직원에 적용한다", () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.dashboard.assignments = [assignment];
    settings.permissions.userOverrides = [{ userId: id, menu: "dashboard", access: "none" }];
    expect(dashboardMembers([row], new Set(), settings)[0]).toMatchObject({ bundle: "desk", canOpen: false, scopeLabel: "영어" });
    expect(dashboardMembers([row], new Set([id]), settings)[0]).toMatchObject({ bundle: "super", canOpen: true, scopeLabel: "전 과목" });
  });
  it("퇴직·대기 직원과 학생은 실제 적용 직원 수에 섞지 않는다", () => {
    expect(dashboardMembers([{ ...row, status: "inactive" }, { ...row, status: "pending" }, { ...row, system_role: "student" }], new Set(), DEFAULT_SETTINGS)).toEqual([]);
  });
});
