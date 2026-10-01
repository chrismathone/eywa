import { beforeEach, describe, expect, it, vi } from "vitest";
import { navigationRevision } from "../normalize-navigation";

const m = vi.hoisted(() => ({
  actor: { id: "actor", tenantId: "tenant-a", systemRole: "master" }, allowed: true,
  stored: { data: { profile: { name: "학원" }, navigation: { menus: [], groups: [], teacherMenus: [] } }, updated_at: "2026-09-29T12:00:00Z" } as unknown,
  error: null as unknown, rows: [{ tenant_id: "tenant-a" }] as unknown[],
  write: vi.fn(), filters: vi.fn(), audit: vi.fn(), updateTag: vi.fn(), revalidatePath: vi.fn(),
}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => m.actor }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canWriteTenant: async () => m.allowed }));
vi.mock("@/lib/auth/super-admin", () => ({ isCurrentUserSuperAdmin: async () => false }));
vi.mock("@/features/audit/server/log", () => ({ logAction: m.audit }));
vi.mock("./queries", () => ({ tenantSettingsTag: (id: string) => `settings:${id}` }));
vi.mock("next/cache", () => ({ updateTag: m.updateTag, revalidatePath: m.revalidatePath }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/storage/media-storage", () => ({ createUploadTicket: vi.fn(), MEDIA_KIND: {} }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: () => {
  const writer = { eq: (...args: unknown[]) => { m.filters(...args); return writer; }, select: async () => ({ data: m.rows, error: m.error }) };
  return {
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: m.stored, error: null }) }) }),
    update: (value: unknown) => { m.write("update", value); return writer; },
    insert: (value: unknown) => { m.write("insert", value); return writer; },
  };
} }) }));
import { saveOwnerSection } from "./actions";

const empty = { menus: [], groups: [], teacherMenus: [] };
const configuration = { menus: [{ href: "/students", label: "우리 아이들", icon: "star", groupId: "custom-team" }], groups: [{ id: "custom-team", label: "교무실", icon: "folder" }], teacherMenus: [] };
function form(value = configuration, baseline = navigationRevision(empty)) {
  const fd = new FormData(); fd.set("section", "navigation"); fd.set("data", JSON.stringify(value)); fd.set("navigationBaseline", baseline); return fd;
}
beforeEach(() => {
  vi.clearAllMocks(); m.actor.systemRole = "master"; m.allowed = true; m.error = null; m.rows = [{ tenant_id: "tenant-a" }];
  m.stored = { data: { profile: { name: "학원" }, navigation: empty }, updated_at: "2026-09-29T12:00:00Z" };
});
describe("실제 학원 설정 저장 액션", () => {
  it("owner를 위임받았어도 역할별 대시보드 공개 설정은 바꿀 수 없다", async () => {
    m.actor.systemRole = "admin";
    const fd = new FormData();
    fd.set("section", "dashboard");
    fd.set("data", JSON.stringify({ version: 1, layouts: [] }));
    expect((await saveOwnerSection(undefined, fd))?.error).toContain("원장");
    expect(m.write).not.toHaveBeenCalled();
  });
  it("원장의 대시보드 배치를 정리해 현재 지점에 저장하고 운영실을 갱신한다", async () => {
    const dashboard = { version: 1, layouts: [{ role: "desk", items: [{ id: "panel:notices", w: 6, h: 1 }] }] };
    const fd = new FormData();
    fd.set("section", "dashboard");
    fd.set("data", JSON.stringify(dashboard));
    expect((await saveOwnerSection(undefined, fd))?.ok).toBe(true);
    expect(m.write).toHaveBeenCalledWith("update", expect.objectContaining({ data: expect.objectContaining({ dashboard }) }));
    expect(m.revalidatePath).toHaveBeenCalledWith("/dashboard");
  });
  it("owner 쓰기 권한이 없는 계정은 저장할 수 없다", async () => {
    m.allowed = false;
    expect((await saveOwnerSection(undefined, form()))?.error).toContain("권한");
    expect(m.write).not.toHaveBeenCalled();
  });
  it("현재 학원에만 저장하고 다른 섹션을 보존하며 감사/캐시를 갱신한다", async () => {
    expect((await saveOwnerSection(undefined, form()))?.ok).toBe(true);
    expect(m.write).toHaveBeenCalledWith("update", expect.objectContaining({ tenant_id: "tenant-a", updated_by: "actor", data: expect.objectContaining({ profile: { name: "학원" }, navigation: configuration }) }));
    expect(m.filters).toHaveBeenCalledWith("tenant_id", "tenant-a");
    expect(m.filters).toHaveBeenCalledWith("updated_at", "2026-09-29T12:00:00Z");
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "owner_settings_update" }));
    expect(m.updateTag).toHaveBeenCalledWith("settings:tenant-a");
    expect(m.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });
  it("다른 창에서 바뀐 메뉴를 오래된 폼이 덮어쓰지 않는다", async () => {
    m.stored = { data: { navigation: configuration }, updated_at: "later" };
    expect((await saveOwnerSection(undefined, form()))?.error).toContain("다른 창");
    expect(m.write).not.toHaveBeenCalled();
  });
  it("조회와 저장 사이 다른 섹션의 저장이 경합해도 실패를 보고하고 감사 성공을 남기지 않는다", async () => {
    m.rows = [];
    expect((await saveOwnerSection(undefined, form()))?.error).toContain("다른 창");
    expect(m.audit).not.toHaveBeenCalled();
    expect(m.updateTag).not.toHaveBeenCalled();
  });
  it("첫 저장은 현재 학원 행을 생성한다", async () => {
    m.stored = null;
    expect((await saveOwnerSection(undefined, form()))?.ok).toBe(true);
    expect(m.write).toHaveBeenCalledWith("insert", expect.objectContaining({ tenant_id: "tenant-a" }));
  });
  it("DB 저장 실패는 성공 신호/캐시 갱신으로 이어지지 않는다", async () => {
    m.error = { message: "저장 실패" };
    expect((await saveOwnerSection(undefined, form()))?.error).toBe("저장 실패");
    expect(m.audit).not.toHaveBeenCalled(); expect(m.updateTag).not.toHaveBeenCalled();
  });
});
