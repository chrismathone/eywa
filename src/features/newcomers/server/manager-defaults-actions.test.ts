import { beforeEach, describe, expect, it, vi } from "vitest";
import { markFolded } from "@/lib/folded-read";

/**
 * 신규생 과목 기본 담당 저장(2026-11-11) — 자격 · 과목 · 담당자 · 동시 저장 · 기록 명의를 모의 DB로 확인한다.
 * 감사 기록은 이 액션이 아니라 DB 트리거(s2_0066)가 남긴다 — 그 SQL은 manager-defaults.test.ts가 본다. 합성 값만 쓴다.
 */
const TENANT = "tenant-a";
const ADMIN = "11111111-1111-4111-8111-111111111111"; // 실제 로그인 계정
const TARGET = "22222222-2222-4222-8222-222222222222"; // 강사뷰 대상(권한 판정의 '사람')
const MANAGER = "33333333-3333-4333-8333-333333333333"; // 새 기본 담당
const STAMP = "2026-11-10T16:46:59.510883+00:00";
const TABLE = "student_onboarding_manager_defaults";
type Result = { data: unknown; error: null | { code?: string; message?: string } };

const m = vi.hoisted(() => ({
  access: vi.fn(), actor: vi.fn(), readonly: vi.fn(), settings: vi.fn(), refresh: vi.fn(),
  row: { data: null, error: null } as Result, person: { data: null, error: null } as Result, save: { data: null, error: null } as Result,
  calls: [] as { table: string; method: string; args: unknown[] }[],
}));
vi.mock("./followup-query", () => ({ followupAccess: m.access }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: m.actor }));
vi.mock("@/lib/auth/view-as", () => ({ readonlyTeacherViewError: m.readonly }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: m.settings }));
vi.mock("next/cache", () => ({ revalidatePath: m.refresh }));
vi.mock("next/navigation", () => ({ unstable_rethrow: () => {} }));
vi.mock("@/lib/observability/report-error", () => ({ reportError: vi.fn(), reportWarning: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      let write = false;
      const query: unknown = new Proxy({}, {
        get: (_, key) => key === "then"
          ? (resolve: (v: unknown) => unknown) => Promise.resolve(write ? m.save : table === "users" ? m.person : m.row).then(resolve)
          : (...args: unknown[]) => { if (key === "insert" || key === "update") write = true; m.calls.push({ table, method: String(key), args }); return query; },
      });
      return query;
    },
  }),
}));
import { saveNewcomerDefaultManager } from "./manager-defaults-actions";

const settings = (disabled: string[] = []) => ({ operations: { subjects: [{ key: "math", label: "수학", color: "blue" }, { key: "english", label: "영어", color: "rose" }] }, modules: { disabled } });
const input = (patch: Record<string, unknown> = {}) => ({ subject: "math", managerId: MANAGER, expectedUpdatedAt: STAMP, ...patch });
const writes = () => m.calls.filter((c) => c.method === "insert" || c.method === "update");

beforeEach(() => {
  vi.clearAllMocks();
  m.calls = [];
  m.access.mockResolvedValue({ user: { id: ADMIN, tenantId: TENANT, systemRole: "admin" }, canManage: true, canReport: true, scoped: false });
  m.actor.mockResolvedValue({ id: ADMIN, tenantId: TENANT, systemRole: "admin" });
  m.readonly.mockResolvedValue(null);
  m.settings.mockResolvedValue(settings());
  m.row = { data: { subject: "math" }, error: null };
  m.person = { data: { id: MANAGER }, error: null };
  m.save = { data: { subject: "math" }, error: null };
});

describe("자격 — 학생별 담당 배정과 같은 canManage · 읽기 보기에서는 저장하지 않는다", () => {
  it("🔴 담당 범위(강사 · '담당') 계정은 바꿀 수 없다 — DB에 닿지 않는다", async () => {
    m.access.mockResolvedValue({ user: { id: TARGET, tenantId: TENANT, systemRole: "teacher" }, canManage: false, canReport: true, scoped: true });
    const res = await saveNewcomerDefaultManager(input());
    expect(res).toEqual({ ok: false, error: "과목 기본 담당을 바꿀 권한이 없습니다" });
    expect(m.calls).toHaveLength(0);
  });
  it("🔴 지점 보기 · 읽기 강사뷰에서는 저장하지 않는다", async () => {
    m.access.mockResolvedValue({ user: { id: ADMIN, tenantId: TENANT, systemRole: "master", tenantView: { tenantId: TENANT, tenantName: "학원" } }, canManage: false, canReport: false, scoped: false });
    expect((await saveNewcomerDefaultManager(input())).error).toBe("현재 보기에서는 기록을 변경할 수 없습니다");
    m.access.mockResolvedValue({ user: { id: TARGET, tenantId: TENANT, systemRole: "admin" }, canManage: true, canReport: true, scoped: false });
    m.readonly.mockResolvedValue("읽기 전용 강사뷰입니다");
    expect((await saveNewcomerDefaultManager(input())).error).toBe("현재 보기에서는 기록을 변경할 수 없습니다");
    expect(m.calls).toHaveLength(0);
  });
  it("권한이 없으면(메뉴 '없음') 그 사유를 그대로 알린다 · 로그인 계정이 다른 지점이면 거절", async () => {
    m.access.mockRejectedValue(Error("신입생 관리 권한이 없습니다"));
    expect((await saveNewcomerDefaultManager(input())).error).toBe("신입생 관리 권한이 없습니다");
    m.access.mockResolvedValue({ user: { id: TARGET, tenantId: TENANT, systemRole: "admin" }, canManage: true, canReport: true, scoped: false });
    m.actor.mockResolvedValue({ id: ADMIN, tenantId: "tenant-b", systemRole: "admin" });
    expect((await saveNewcomerDefaultManager(input())).error).toBe("로그인 정보를 확인해 주세요");
    expect(writes()).toHaveLength(0);
  });
  it("요청 모양이 틀리면(과목 키 · 담당자 id · 기준 값) 권한을 보기 전에 거절한다", async () => {
    for (const bad of [input({ subject: "Math!" }), input({ managerId: "x" }), input({ expectedUpdatedAt: "어제" }), input({ extra: 1 }), null]) {
      expect((await saveNewcomerDefaultManager(bad)).error).toBe("과목과 담당자를 확인해 주세요");
    }
    expect(m.access).not.toHaveBeenCalled();
  });
});

describe("과목 — 지금 과목 + 이미 줄이 있는 EiE만", () => {
  it("🔴 학원 설정에 없는 과목(지운 과목 포함)은 줄이 남아 있어도 받지 않는다", async () => {
    m.row = { data: { subject: "science" }, error: null };
    expect((await saveNewcomerDefaultManager(input({ subject: "science" }))).error).toBe("지금 쓰는 과목에만 기본 담당을 지정할 수 있습니다");
    expect(writes()).toHaveLength(0);
  });
  it("EiE는 줄이 이미 있고 EiE 기능이 켜진 지점에서만 — 없는 줄을 새로 만들지 않는다", async () => {
    m.row = { data: { subject: "eie" }, error: null };
    expect((await saveNewcomerDefaultManager(input({ subject: "eie" }))).ok).toBe(true);
    m.calls = [];
    m.row = { data: null, error: null };
    expect((await saveNewcomerDefaultManager(input({ subject: "eie", expectedUpdatedAt: null }))).ok).toBe(false);
    m.row = { data: { subject: "eie" }, error: null };
    m.settings.mockResolvedValue(settings(["eie"]));
    expect((await saveNewcomerDefaultManager(input({ subject: "eie" }))).ok).toBe(false);
    expect(writes()).toHaveLength(0);
  });
  it("🔴 학원 설정을 못 읽어 기본값으로 접힌 값이면 과목을 믿지 않는다 — 저장하지 않는다", async () => {
    m.settings.mockResolvedValue(markFolded(settings(), "학원 설정을 읽지 못했습니다"));
    expect((await saveNewcomerDefaultManager(input())).error).toContain("과목 목록을 확인하지 못해");
    m.settings.mockResolvedValue(settings());
    m.row = { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } };
    expect((await saveNewcomerDefaultManager(input())).error).toContain("과목 목록을 확인하지 못해");
    expect(writes()).toHaveLength(0);
  });
});

describe("담당자 — 이 학원의 재직 중인 원장·관리자·매니저·상담", () => {
  it("🔴 다른 지점 · 퇴사 · 다른 역할이면 거절한다(지점 · 재직 · 역할 조건으로 찾는다)", async () => {
    m.person = { data: null, error: null };
    expect((await saveNewcomerDefaultManager(input())).error).toBe("현재 학원의 관리 담당자를 선택해 주세요");
    expect(writes()).toHaveLength(0);
    const users = m.calls.filter((c) => c.table === "users");
    expect(users).toContainEqual({ table: "users", method: "eq", args: ["tenant_id", TENANT] });
    expect(users).toContainEqual({ table: "users", method: "eq", args: ["status", "active"] });
    expect(users).toContainEqual({ table: "users", method: "in", args: ["system_role", ["master", "admin", "manager", "counselor"]] });
  });
});

describe("저장 — 연 때의 값 그대로일 때만 고친다 · 줄이 없으면 새로 넣는다", () => {
  it("줄이 있으면 지점 · 과목 · 기준 값(글자 그대로)이 맞을 때만 고친다 — 기록 명의는 실제 로그인 계정", async () => {
    // 전체 강사뷰: 권한 판정의 '사람'은 대상이지만 저장한 사람(updated_by)은 실제 계정이다(#154).
    m.access.mockResolvedValue({ user: { id: TARGET, tenantId: TENANT, systemRole: "admin" }, canManage: true, canReport: true, scoped: false });
    expect(await saveNewcomerDefaultManager(input())).toEqual({ ok: true });
    const table = m.calls.filter((c) => c.table === TABLE);
    expect(table.find((c) => c.method === "update")!.args[0]).toEqual({ manager_id: MANAGER, updated_by: ADMIN });
    for (const cond of [["tenant_id", TENANT], ["subject", "math"], ["updated_at", STAMP]]) expect(table).toContainEqual({ table: TABLE, method: "eq", args: cond });
    expect(table.some((c) => c.method === "insert" || c.method === "delete" || c.method === "upsert")).toBe(false);
    expect(m.refresh).toHaveBeenCalledWith("/newcomers");
  });
  it("🔴 그사이 다른 사람이 바꿨으면(0행) 충돌로 알린다 — 성공으로 처리하지 않는다", async () => {
    m.save = { data: null, error: null };
    const res = await saveNewcomerDefaultManager(input());
    expect(res).toMatchObject({ ok: false, conflict: true });
    expect(res.error).toContain("먼저 바꿨습니다");
  });
  it("줄이 없으면 새로 넣는다 · 그사이 생겼으면(중복 키) 충돌", async () => {
    m.row = { data: null, error: null };
    m.settings.mockResolvedValue(settings());
    expect(await saveNewcomerDefaultManager(input({ subject: "english", expectedUpdatedAt: null }))).toEqual({ ok: true });
    expect(writes()).toEqual([{ table: TABLE, method: "insert", args: [{ tenant_id: TENANT, subject: "english", manager_id: MANAGER, updated_by: ADMIN }] }]);
    m.save = { data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "student_onboarding_manager_defaults_pkey"' } };
    expect(await saveNewcomerDefaultManager(input({ subject: "english", expectedUpdatedAt: null }))).toMatchObject({ ok: false, conflict: true });
  });
  it("DB가 거절하면 한글 사유를 낸다 — 검증 트리거의 문장은 그대로, 모르는 오류는 일반 문구(영문 원문을 내지 않는다)", async () => {
    m.save = { data: null, error: { code: "23514", message: "현재 학원의 관리 담당자를 선택해 주세요" } };
    expect(await saveNewcomerDefaultManager(input())).toEqual({ ok: false, error: "현재 학원의 관리 담당자를 선택해 주세요" });
    m.save = { data: null, error: { code: "XX000", message: "internal error at relation foo" } };
    expect(await saveNewcomerDefaultManager(input())).toEqual({ ok: false, error: "기본 담당을 저장하지 못했습니다. 다시 시도해 주세요." });
    expect(m.refresh).not.toHaveBeenCalled();
  });
});
