import { beforeEach, describe, expect, it, vi } from "vitest";
import { toBoardItems } from "@/features/dashboard/layout/board";
import { navigationRevision } from "../normalize-navigation";
import { resolveSettings } from "../resolve";

const m = vi.hoisted(() => ({
  actor: { id: "actor", tenantId: "tenant-a", systemRole: "master" }, allowed: true,
  stored: { data: { profile: { name: "학원" }, navigation: { menus: [], groups: [], teacherMenus: [] } }, updated_at: "2026-09-29T12:00:00Z" } as unknown,
  error: null as unknown, rows: [{ tenant_id: "tenant-a" }] as unknown[],
  write: vi.fn(), filters: vi.fn(), audit: vi.fn(), updateTag: vi.fn(), revalidatePath: vi.fn(), assignments: vi.fn(),
  protectedIds: new Set<string>(), protectionError: false,
}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => m.actor }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canWriteTenant: async () => m.allowed }));
vi.mock("@/lib/auth/super-admin", () => ({ isCurrentUserSuperAdmin: async () => false }));
vi.mock("@/features/audit/server/log", () => ({ logAction: m.audit }));
vi.mock("./queries", () => ({ tenantSettingsTag: (id: string) => `settings:${id}` }));
vi.mock("next/cache", () => ({ updateTag: m.updateTag, revalidatePath: m.revalidatePath }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (table: string) => ({ select: () => {
  // 직원 조회(users) — 개인별 권한의 대상이 이 지점의 재직 직원인지 확인하는 조회. 물어본 사람은 전부 재직 관리자라고 답한다.
  if (table === "users") {
    let wanted: string[] = [];
    const chain = { eq: () => chain, in: (_key: string, ids: string[]) => { wanted = ids; return chain; }, limit: async () => ({ data: wanted.map((id) => ({ id, system_role: "admin", status: "active" })), error: null }) };
    return chain;
  }
  return { in: async (_key: string, ids: string[]) => ({
    data: ids.filter((id) => m.protectedIds.has(id)).map((id) => ({ id })), error: m.protectionError ? { message: "lookup failed" } : null,
  }) };
} }) }) }));
vi.mock("./dashboard-assignments", () => ({ validateDashboardAssignments: m.assignments }));
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
import { permissionsToken } from "./permissions-save";

const empty = { menus: [], groups: [], teacherMenus: [] };
const configuration = { menus: [{ href: "/students", label: "우리 아이들", icon: "star", groupId: "custom-team" }], groups: [{ id: "custom-team", label: "교무실", icon: "folder" }], teacherMenus: [] };
function form(value = configuration, baseline = navigationRevision(empty)) {
  const fd = new FormData(); fd.set("section", "navigation"); fd.set("data", JSON.stringify(value)); fd.set("navigationBaseline", baseline); return fd;
}
beforeEach(() => {
  vi.clearAllMocks(); m.actor.systemRole = "master"; m.allowed = true; m.error = null; m.rows = [{ tenant_id: "tenant-a" }];
  m.assignments.mockResolvedValue(null);
  m.protectedIds.clear(); m.protectionError = false;
  m.stored = { data: { profile: { name: "학원" }, navigation: empty }, updated_at: "2026-09-29T12:00:00Z" };
});
describe("실제 학원 설정 저장 액션", () => {
  const assignment = { userId: "11111111-1111-4111-8111-111111111111", scope: "subjects", subjects: ["math"], adminLayout: "desk" };
  it("배치 편집만 저장하면 직원관리에서 지정한 과목·배정을 보존한다", async () => {
    m.stored = { data: { dashboard: { version: 1, layouts: [], assignments: [assignment] } }, updated_at: "now" };
    const fd = new FormData(); fd.set("section", "dashboard"); fd.set("data", JSON.stringify({ version: 1, layouts: [] }));
    expect((await saveOwnerSection(undefined, fd))?.ok).toBe(true);
    expect(m.write).toHaveBeenCalledWith("update", expect.objectContaining({ data: expect.objectContaining({ dashboard: { version: 1, layouts: [], assignments: [assignment] } }) }));
  });
  it("지점에서 운영자 배치를 새로 만드는 직접 요청을 거절한다", async () => {
    const fd = new FormData(); fd.set("section", "dashboard"); fd.set("data", JSON.stringify({ version: 1, layouts: [{ role: "super", items: [{ id: "panel:notices", w: 6, h: 1 }] }] }));
    expect((await saveOwnerSection(undefined, fd))?.error).toContain("지점에서 변경할 수 없습니다");
    expect(m.write).not.toHaveBeenCalled();
  });
  it("운영자 개인의 배정과 권한 예외는 직접 요청으로도 추가할 수 없다", async () => {
    m.protectedIds.add(assignment.userId);
    for (const [section, data] of [
      ["dashboard", { version: 1, layouts: [], assignments: [assignment] }],
      ["permissions", { overrides: [], userOverrides: [{ userId: assignment.userId, menu: "staff", access: "full" }] }],
    ] as const) {
      const fd = new FormData(); fd.set("section", section); fd.set("data", JSON.stringify(data));
      // 역할·권한 저장은 화면이 연 시점의 기준 token이 있어야 여기(운영 설정 보호 검사)까지 온다.
      if (section === "permissions") {
        fd.set("permissionsBaseline", permissionsToken(resolveSettings((m.stored as { data: unknown }).data, { name: "" }).permissions));
      }
      expect((await saveOwnerSection(undefined, fd))?.error).toContain("지점에서 변경할 수 없습니다");
    }
    expect(m.write).not.toHaveBeenCalled();
  });
  it("운영자 명단 조회 실패 때 저장과 성공 감사를 하지 않는다", async () => {
    m.protectionError = true;
    const fd = new FormData(); fd.set("section", "dashboard"); fd.set("data", JSON.stringify({ version: 1, layouts: [], assignments: [assignment] }));
    expect((await saveOwnerSection(undefined, fd))?.error).toContain("확인하지 못했습니다");
    expect(m.write).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled();
  });
  it("다른 창이 바꾼 배정·배치를 옛 폼으로 덮지 않는다", async () => {
    const fd = new FormData(); fd.set("section", "dashboard"); fd.set("data", JSON.stringify({ version: 1, layouts: [] })); fd.set("dashboardBaseline", JSON.stringify({ version: 1, layouts: [], assignments: [assignment] }));
    expect((await saveOwnerSection(undefined, fd))?.error).toContain("다른 창");
    expect(m.write).not.toHaveBeenCalled();
  });
  it("다른 지점 직원 배정은 서버 검증에서 거절하고 저장하지 않는다", async () => {
    m.assignments.mockResolvedValue("현재 지점의 직원만 대시보드에 배정할 수 있습니다");
    const fd = new FormData(); fd.set("section", "dashboard"); fd.set("data", JSON.stringify({ version: 1, layouts: [], assignments: [assignment] }));
    expect((await saveOwnerSection(undefined, fd))?.error).toContain("현재 지점");
    expect(m.assignments).toHaveBeenCalledWith("tenant-a", [assignment]);
    expect(m.write).not.toHaveBeenCalled();
  });
  it("owner를 위임받았어도 역할별 대시보드 공개 설정은 바꿀 수 없다", async () => {
    m.actor.systemRole = "admin";
    const fd = new FormData();
    fd.set("section", "dashboard");
    fd.set("data", JSON.stringify({ version: 1, layouts: [] }));
    expect((await saveOwnerSection(undefined, fd))?.error).toContain("원장");
    expect(m.write).not.toHaveBeenCalled();
  });
  it("원장의 대시보드 배치를 정리해 현재 지점에 저장하고 운영실을 갱신한다", async () => {
    // 저장값은 새 대시보드 모양(`board.ts`)으로 정리된다 — 이미 그 모양인 배치는 그대로 저장된다.
    const dashboard = { version: 1, layouts: [{ role: "desk", items: toBoardItems([{ id: "panel:notices", w: 6, h: 1 }]) }], assignments: [] };
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
    // DB 원문은 화면에 내보내지 않는다 — 모르는 오류는 기본 문구로.
    m.error = { message: "connection terminated unexpectedly" };
    expect((await saveOwnerSection(undefined, form()))?.error).toBe("설정을 저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
    m.error = { message: "저장 실패" };
    expect((await saveOwnerSection(undefined, form()))?.error).not.toBe("저장 실패");
    expect(m.audit).not.toHaveBeenCalled(); expect(m.updateTag).not.toHaveBeenCalled();
  });
});
