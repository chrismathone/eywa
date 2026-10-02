import { beforeEach, expect, it, vi } from "vitest";
import { settingRoleSelection } from "../setting-roles";
import type { SettingsRoleGroup } from "@/lib/settings-role-catalog";

const m = vi.hoisted(() => ({
  actor: { id: "actor", tenantId: "tenant-a", systemRole: "master" } as { id: string; tenantId: string; systemRole: string } | null,
  super: false, readonly: false,
  data: {} as Record<string, unknown>, readError: null as unknown, writeError: null as unknown, affected: true,
  from: vi.fn(), write: vi.fn(), filters: vi.fn(), audit: vi.fn(), tag: vi.fn(), path: vi.fn(),
}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => m.actor }));
vi.mock("@/lib/auth/super-admin", () => ({ isCurrentUserSuperAdmin: async () => m.super }));
vi.mock("@/lib/auth/view-as", () => ({ isReadonlyTeacherView: async () => m.readonly }));
vi.mock("@/features/audit/server/log", () => ({ logAction: m.audit }));
vi.mock("./queries", () => ({ tenantSettingsTag: (id: string) => `settings:${id}` }));
vi.mock("next/cache", () => ({ updateTag: m.tag, revalidatePath: m.path }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: m.from }) }));
import { saveSettingRoles } from "./setting-role-actions";

const initial = () => settingRoleSelection("lesson_reports", []);
const selection = () => ({ ...initial(), report_settings: ["master", "admin"] as ("master" | "admin")[] });
const baseline = () => JSON.stringify(initial());
beforeEach(() => {
  vi.clearAllMocks();
  m.actor = { id: "actor", tenantId: "tenant-a", systemRole: "master" }; m.super = false; m.readonly = false;
  m.data = { profile: { name: "preserve" }, permissions: { overrides: [], userOverrides: [{ userId: "u1", menu: "staff", access: "full" }], futureOption: true } };
  m.readError = null; m.writeError = null; m.affected = true;
  m.from.mockImplementation(() => {
    const writer = {
      eq: (...args: unknown[]) => { m.filters(...args); return writer; },
      select: async () => ({ data: m.affected ? [{ tenant_id: "tenant-a" }] : [], error: m.writeError }),
    };
    return {
      select: () => ({ eq: (...args: unknown[]) => { m.filters(...args); return { maybeSingle: async () => ({ data: { data: m.data, updated_at: "revision-1" }, error: m.readError }) }; } }),
      update: (value: unknown) => { m.write(value); return writer; },
    };
  });
});

it.each(["admin", "manager", "teacher", "accountant", "student"])("%s는 요청을 직접 보내도 역할을 올릴 수 없다", async (role) => {
  m.actor!.systemRole = role;
  expect((await saveSettingRoles("lesson_reports", selection(), baseline())).error).toContain("권한이 없습니다");
  expect(m.from).not.toHaveBeenCalled();
});
it("로그인하지 않으면 조회도 하지 않는다", async () => {
  m.actor = null;
  expect((await saveSettingRoles("lesson_reports", selection(), baseline())).error).toContain("로그인");
  expect(m.from).not.toHaveBeenCalled();
});
it("다른 강사 보기에서는 원장·슈퍼관리자도 수정할 수 없다", async () => {
  m.super = true; m.readonly = true;
  expect((await saveSettingRoles("lesson_reports", selection(), baseline())).error).toBeTruthy();
  expect(m.from).not.toHaveBeenCalled();
});
it.each(["__proto__", "constructor", "staff"])("조작한 그룹 %s를 거부한다", async group => {
  expect((await saveSettingRoles(group as SettingsRoleGroup, selection(), baseline())).error).toBeTruthy();
  expect(m.from).not.toHaveBeenCalled();
});
it("다른 메뉴·학생·원장 제외·누락 필드를 받지 않는다", async () => {
  for (const input of [
    { ...selection(), staff: ["admin"] },
    { ...selection(), report_settings: ["master", "student"] },
    { ...selection(), report_settings: ["admin"] },
    { report_settings: ["master"] },
  ]) {
    expect((await saveSettingRoles("lesson_reports", input as ReturnType<typeof selection>, baseline())).error).toBeTruthy();
  }
  expect(m.from).not.toHaveBeenCalled();
});
it("원장 역할이 아닌 슈퍼관리자도 자기 학원에서만 저장하고 개인 예외·다른 설정을 보존한다", async () => {
  m.actor!.systemRole = "admin"; m.super = true;
  const result = await saveSettingRoles("lesson_reports", selection(), baseline());
  expect(result.error).toBeUndefined();
  expect(result.selection?.report_settings).toContain("admin");
  expect(m.filters).toHaveBeenCalledWith("tenant_id", "tenant-a");
  expect(m.filters).toHaveBeenCalledWith("updated_at", "revision-1");
  expect(m.write).toHaveBeenCalledWith(expect.objectContaining({ updated_by: "actor", data: expect.objectContaining({
    profile: { name: "preserve" }, permissions: expect.objectContaining({ userOverrides: [{ userId: "u1", menu: "staff", access: "full" }], futureOption: true }),
  }) }));
  expect(m.audit).toHaveBeenCalledOnce();
  expect(m.tag).toHaveBeenCalledWith("settings:tenant-a");
});
it("열어 둔 사이 역할이 바뀌었으면 덮어쓰지 않는다", async () => {
  m.data.permissions = { overrides: [{ menu: "ai_ment", role: "manager", access: "full" }] };
  expect((await saveSettingRoles("lesson_reports", selection(), baseline())).error).toContain("다른 창");
  expect(m.write).not.toHaveBeenCalled();
});
it.each(["read", "write", "conflict"])("%s 실패를 성공으로 알리거나 캐시를 갱신하지 않는다", async stage => {
  if (stage === "read") m.readError = { message: "db failed" };
  if (stage === "write") m.writeError = { message: "db failed" };
  if (stage === "conflict") m.affected = false;
  expect((await saveSettingRoles("lesson_reports", selection(), baseline())).error).toBeTruthy();
  expect(m.audit).not.toHaveBeenCalled(); expect(m.tag).not.toHaveBeenCalled();
});
