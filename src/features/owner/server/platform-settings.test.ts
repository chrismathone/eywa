import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PermissionsSettings } from "../settings-types";
import { permissionAccountIds, platformAccountIds, platformSettingsError } from "./platform-settings";

const sa = "11111111-1111-4111-8111-111111111111";
const staff = "22222222-2222-4222-8222-222222222222";
const m = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => ({ select: () => ({ in: m.query }) }) }) }));
beforeEach(() => {
  m.query.mockReset().mockImplementation(async (_key: string, ids: string[]) => ({ data: ids.filter((id) => id === sa).map((id) => ({ id })), error: null }));
});
const rule = { userId: sa, menu: "staff", access: "full" };
const permissions = { overrides: [], userOverrides: [rule], specialAccess: { payslipViewerIds: [sa], leaveAdjusterIds: [sa], classSplitterIds: [sa], staffSubjectScopes: [{ userId: sa, subjects: ["math"] }] } };
const layout = { role: "super", items: [{ id: "panel:notices", w: 6, h: 1 }] };
const assignment = { userId: sa, scope: "all", subjects: [], adminLayout: "desk" };
const dashboard = { version: 1, layouts: [layout], assignments: [assignment] };

describe("지점 설정과 운영자 설정 경계", () => {
  it("운영자 설정이 그대로면 지점 역할·직원 설정을 함께 저장한다", async () => {
    expect(await platformSettingsError("permissions", { ...permissions, userOverrides: [...permissions.userOverrides, { ...rule, userId: staff }] }, permissions)).toBeNull();
    expect(await platformSettingsError("dashboard", { ...dashboard, layouts: [layout, { ...layout, role: "owner" }], assignments: [assignment, { ...assignment, userId: staff }] }, dashboard)).toBeNull();
    expect(await platformSettingsError("permissions", { overrides: [] }, undefined)).toBeNull();
  });
  it("운영자 배치의 추가·수정·삭제를 거절한다", async () => {
    for (const [next, previous] of [
      [dashboard, undefined],
      [{ ...dashboard, layouts: [] }, dashboard],
      [{ ...dashboard, layouts: [{ ...layout, items: [{ id: "panel:schedule", w: 12, h: 2 }] }] }, dashboard],
    ]) expect(await platformSettingsError("dashboard", next, previous)).not.toBeNull();
  });
  it("기존 운영자 배정을 없애거나 범위를 바꾸는 요청도 거절한다", async () => {
    expect(await platformSettingsError("dashboard", { ...dashboard, assignments: [] }, dashboard)).not.toBeNull();
    expect(await platformSettingsError("dashboard", { ...dashboard, assignments: [{ ...assignment, scope: "unassigned" }] }, dashboard)).not.toBeNull();
  });
  it("운영자 권한 예외 및 민감 기능 명단의 추가·삭제·변경을 거절한다", async () => {
    expect(await platformSettingsError("permissions", permissions, undefined)).not.toBeNull();
    expect(await platformSettingsError("permissions", { ...permissions, userOverrides: [] }, permissions)).not.toBeNull();
    expect(await platformSettingsError("permissions", { ...permissions, userOverrides: [{ ...rule, access: "none" }] }, permissions)).not.toBeNull();
    for (const key of ["payslipViewerIds", "leaveAdjusterIds", "classSplitterIds", "staffSubjectScopes"] as const) {
      expect(await platformSettingsError("permissions", { ...permissions, specialAccess: { ...permissions.specialAccess, [key]: [] } }, permissions)).not.toBeNull();
    }
    // 과목 범위는 과목만 바꾸는 것도 변경이다.
    const rescoped = { ...permissions.specialAccess, staffSubjectScopes: [{ userId: sa, subjects: ["english"] }] };
    expect(await platformSettingsError("permissions", { ...permissions, specialAccess: rescoped }, permissions)).not.toBeNull();
    // 지점 직원의 지정은 운영자 줄이 그대로면 함께 저장된다.
    const withStaff = { ...permissions.specialAccess, classSplitterIds: [sa, staff], staffSubjectScopes: [...permissions.specialAccess.staffSubjectScopes, { userId: staff, subjects: ["math"] }] };
    expect(await platformSettingsError("permissions", { ...permissions, specialAccess: withStaff }, permissions)).toBeNull();
  });
  it("깨진 저장값(줄이 null · 목록이 아닌 칸)에도 계정 모으기가 던지지 않는다 — 학원 설정 화면이 스키마를 안 거친 값으로 부른다", () => {
    const broken = {
      overrides: [],
      userOverrides: [null, { userId: 3 }, rule],
      specialAccess: { payslipViewerIds: "x", leaveAdjusterIds: [sa, 7], staffSubjectScopes: [null, { userId: staff }] },
    } as unknown as PermissionsSettings;
    expect(permissionAccountIds(broken)).toEqual([sa, sa, staff]);
    expect(permissionAccountIds({ overrides: [] } as unknown as PermissionsSettings)).toEqual([]);
    expect(permissionAccountIds(permissions as PermissionsSettings)).toEqual([sa, sa, sa, sa, sa]);
  });
  it("보호 여부 조회는 작은 묶음으로 나누고 오류를 숨기지 않는다", async () => {
    await platformAccountIds(Array.from({ length: 201 }, (_, i) => String(i)));
    expect(m.query.mock.calls.map((call) => call[1].length)).toEqual([100, 100, 1]);
    m.query.mockResolvedValue({ data: null, error: { message: "unavailable" } });
    await expect(platformAccountIds([sa])).rejects.toThrow("unavailable");
  });
});
