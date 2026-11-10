import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ errorTable: "", from: vi.fn(), realId: "actor", viewId: "teacher", prefs: {} as Record<string, unknown> }));
const classId = "11111111-1111-4111-8111-111111111111", studentId = "22222222-2222-4222-8222-222222222222";
vi.mock("./access", () => ({ requireMcsClassAccess: async () => ({ ok: true, access: { tenantId: "tenant", classId, className: "합성 반", teacherId: null, canWrite: true, user: { id: m.viewId } } }), mcsVisibleClassFilter: async () => null }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => ({ id: m.realId, tenantId: "tenant", systemRole: "master" }) }));
vi.mock("@/lib/auth/perm-matrix", () => ({ accessLevelTenant: async () => "full" }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: m.from,
    // ui_prefs_patch(키 단위 병합) 흉내 — 그 네임스페이스 안 키만 고친다.
    rpc: async (_fn: string, a: { p_user: string; p_ns: string; p_set: Record<string, unknown> }) => {
      const root = { ...((m.prefs[a.p_user] as Record<string, unknown>) ?? {}) };
      root[a.p_ns] = { ...((root[a.p_ns] as Record<string, unknown>) ?? {}), ...a.p_set };
      m.prefs[a.p_user] = root;
      return { error: null };
    },
  }),
}));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: async () => ({ operations: { holidays: [] } }) }));
vi.mock("@/features/audit/server/log", () => ({ logAction: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("./lifecycle", () => ({ mathLifecycleBadges: async () => new Map() }));
import { getMathClassOptions, getMathSheetLanding } from "./landing";
import { getMathSheetMonth } from "./month-queries";
import { setMyMcsFontSize } from "./actions";

beforeEach(() => {
  vi.clearAllMocks(); m.errorTable = ""; m.prefs = {};
  m.from.mockImplementation((table: string) => {
    let id = "", patch: { ui_prefs: unknown } | undefined;
    const q: Record<string, unknown> = {};
    for (const name of ["select", "in", "order", "or", "gte", "lte", "lt", "limit", "range"]) q[name] = () => q;
    q.eq = (key: string, value: string) => { if (key === "id") id = value; return q; };
    q.update = (value: typeof patch) => { patch = value; return q; };
    const result = () => {
      if (m.errorTable === table) return { data: null, error: { code: "XX000", message: "Synthetic database failure" } };
      if (table === "users") { if (patch) m.prefs[id] = patch.ui_prefs; return { data: { ui_prefs: m.prefs[id] ?? {} }, error: null }; }
      return { data: table === "class_schedules" ? [{ day_of_week: "mon", start_time: "16:00", end_time: "17:00", valid_from: null, valid_to: null }]
        : table === "enrollments" ? [{ student_id: studentId, start_date: "2026-01-01", end_date: null, is_transferred: false }]
        : table === "students" ? [{ id: studentId, name: "합성 학생", school: null, grade: "중1", withdrawn_at: null }] : [], error: null };
    };
    q.maybeSingle = () => Promise.resolve(result());
    q.then = (resolve: (result: unknown) => unknown) => Promise.resolve(result()).then(resolve);
    return q;
  });
});
it("반 조회 실패를 활성 반 없음으로 표시하지 않는다", async () => {
  m.errorTable = "classes";
  expect(await getMathSheetLanding("2026-10")).toMatchObject({ ok: false, error: expect.stringContaining("불러오지 못") });
});
it("반 전환 목록 조회 실패도 정상적인 빈 선택지로 반환하지 않는다", async () => {
  m.errorTable = "classes";
  await expect(getMathClassOptions("2026-10")).rejects.toThrow("반 목록을 불러오지 못했습니다");
});
it.each(["class_schedules", "enrollments"])("필수 %s 조회 실패는 정상 학생 0명 시트를 열지 않는다", async table => {
  m.errorTable = table;
  expect(await getMathSheetMonth(classId, "2026-10")).toMatchObject({ ok: false, error: expect.stringContaining("명단") });
});
it("실제 빈 반 목록은 정상 빈 상태로 구분한다", async () => {
  expect(await getMathSheetLanding("2026-10")).toMatchObject({ ok: true, data: { emptyReason: "no-classes" } });
});
it("다른 강사 보기에서도 개인 글씨 크기는 실제 로그인 계정에서 저장·조회한다", async () => {
  m.prefs = { actor: { mcs: { fontSize: "sm" } }, teacher: { mcs: { fontSize: "sm" } } };
  expect(await setMyMcsFontSize("lg")).toEqual({ ok: true });
  expect(await getMathSheetMonth(classId, "2026-10")).toMatchObject({ ok: true, data: { fontSize: "lg" } });
  expect(m.prefs.teacher).toEqual({ mcs: { fontSize: "sm" } });
});
