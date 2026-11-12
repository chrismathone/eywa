import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyUserOverrides, CONNECTED_APP_ACCESS_MESSAGE, isScopedForbiddenRole, MENU_ACCESS, onOffAccessMessage, resolveMatrix, SCOPED_FORBIDDEN_MESSAGE } from "@/lib/permissions";
import { sparseRoleOverrides } from "../permission-edit";
import { resolveSettings } from "../resolve";
import { applySettingRoles, settingRoleSelection } from "../setting-roles";
import type { PermissionsSettings } from "../settings-types";

/**
 * 역할·권한 저장 계약(2026-10-06) — 실제 저장 액션을 **상태를 가진 모의 DB**로 돌려, 여러 곳이 번갈아 쓰는 경우를 확인한다.
 *  · 역할·권한 면은 화면을 연 시점의 값 전체를 되돌려 보낸다. 그사이 다른 곳(다른 창 · '역할 설정' 대화상자 · 운영자 스크립트)이
 *    바꿨으면 저장하지 않는다(기준 token) — 받으면 그 변경이 조용히 되돌아간다.
 *  · 기준은 저장되는 세 칸 전부(역할별 · 개인별 · 담당자)의 **저장된 줄 그대로**다(차례만 무시). 적용하면 같은 표여도
 *    줄이 달라졌으면 다른 저장이다 — 같은 줄을 앱과 DB가 다르게 읽는 자리가 있다(적대 리뷰 2 C1).
 *  · 기존 보호(운영 설정 보호 · 원장 전용)는 그대로다. 개인별 기능 권한(담당자 · 과목 범위)은 어느 학원에서나 저장된다(원장 2026-10-06).
 * 합성 값만 쓴다.
 */
const STAFF_A = "11111111-1111-4111-8111-111111111111";
const STAFF_B = "22222222-2222-4222-8222-222222222222";
const OPERATOR = "99999999-9999-4999-8999-999999999999";

const m = vi.hoisted(() => ({
  actor: { id: "actor", tenantId: "tenant-a", systemRole: "master", displayName: "원장" },
  allowed: true,
  row: null as null | { data: Record<string, unknown>; updated_at: string },
  /** 액션이 읽은 뒤·쓰기 직전에 끼어드는 다른 writer. */
  beforeWrite: null as null | (() => void),
  /** 운영자 계정(지점에서 바꿀 수 없는 대상). */
  platformIds: new Set<string>(),
  staff: [] as { id: string; system_role: string; status: string; tenant_id?: string }[],
  writes: 0,
  audit: vi.fn(),
}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => m.actor }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canWriteTenant: async () => m.allowed }));
vi.mock("@/lib/auth/super-admin", () => ({ isCurrentUserSuperAdmin: async () => false }));
vi.mock("@/features/audit/server/log", () => ({ logAction: m.audit }));
vi.mock("./queries", () => ({ tenantSettingsTag: (id: string) => `settings:${id}` }));
vi.mock("next/cache", () => ({ updateTag: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("./dashboard-assignments", () => ({ validateDashboardAssignments: vi.fn() }));
vi.mock("@/lib/storage/media-storage", () => ({ createUploadTicket: vi.fn(), MEDIA_KIND: {} }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => {
        if (table === "super_admins") {
          return { in: async (_column: string, ids: string[]) => ({ data: ids.filter((id) => m.platformIds.has(id)).map((id) => ({ id })), error: null }) };
        }
        // users — 권한 대상이 현재 지점의 재직 직원인지 확인하는 조회.
        let wanted: string[] = [];
        let tenant = "";
        const chain = {
          eq: (_column: string, id: string) => { tenant = id; return chain; },
          in: (_column: string, ids: string[]) => {
            wanted = ids;
            return chain;
          },
          limit: async () => ({ data: m.staff.filter((u) => wanted.includes(u.id) && (u.tenant_id ?? "tenant-a") === tenant), error: null }),
        };
        return chain;
      },
    }),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: m.row ? structuredClone(m.row) : null, error: null }) }) }),
      update: (value: { data: Record<string, unknown>; updated_at: string }) => {
        const conditions: Record<string, unknown> = {};
        const writer = {
          eq: (column: string, expected: unknown) => {
            conditions[column] = expected;
            return writer;
          },
          select: async () => {
            m.beforeWrite?.();
            m.beforeWrite = null;
            if (!m.row || conditions.updated_at !== m.row.updated_at) return { data: [], error: null };
            m.writes += 1;
            m.row = { data: structuredClone(value.data), updated_at: value.updated_at };
            return { data: [{ tenant_id: "tenant-a" }], error: null };
          },
        };
        return writer;
      },
      insert: (value: { data: Record<string, unknown>; updated_at: string }) => ({
        select: async () => {
          m.writes += 1;
          m.row = { data: structuredClone(value.data), updated_at: value.updated_at };
          return { data: [{ tenant_id: "tenant-a" }], error: null };
        },
      }),
    }),
  }),
}));
import { saveOwnerSection } from "./actions";
import { CHANGED_ELSEWHERE_ERROR, STALE_FORM_ERROR } from "./operations-save";
import { permissionsToken } from "./permissions-save";

/** 지금 DB에 있는 역할·권한(화면·저장이 읽는 것과 같은 해석). */
const stored = (): PermissionsSettings => resolveSettings(m.row?.data ?? null, { name: "" }).permissions;
const rawStored = () => (m.row!.data.permissions ?? {}) as Record<string, unknown>;
/** 다른 곳의 쓰기 — 문서를 바꾸고 수정 표식을 옮긴다(실제 writer는 전부 그렇게 한다 — tenant-settings-writers.test.ts). */
function otherWriter(change: (permissions: Record<string, unknown>) => Record<string, unknown>) {
  m.row = {
    data: { ...m.row!.data, permissions: change(rawStored()) },
    updated_at: new Date(Date.parse(m.row!.updated_at) + 500).toISOString(),
  };
}
const call = (fd: FormData) => {
  vi.setSystemTime(new Date(Date.now() + 1000));
  return saveOwnerSection(undefined, fd);
};
/** 한 창이 역할·권한 면을 연 순간 — 그때의 값과 기준 token을 들고 있다가 나중에 저장한다. */
function openWindow() {
  const draft = stored();
  const baseline = permissionsToken(draft);
  return {
    draft,
    baseline,
    save: (data: unknown, token: string | null = baseline) => {
      const fd = new FormData();
      fd.set("section", "permissions");
      fd.set("data", JSON.stringify(data));
      if (token !== null) fd.set("permissionsBaseline", token);
      return call(fd);
    },
  };
}

const START = { overrides: [{ menu: "staff", role: "teacher", access: "readonly" }], userOverrides: [{ userId: STAFF_A, menu: "staff", access: "full" }] };
function seed(preset: "chinsan" | "generic", permissions: Record<string, unknown> = START) {
  m.row = {
    data: {
      version: 1,
      ...(preset === "generic" ? { preset: "generic" } : {}),
      profile: { name: "학원" },
      permissions: structuredClone(permissions),
    },
    updated_at: "2026-10-06T00:00:00.000Z",
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-06T01:00:00.000Z"));
  vi.clearAllMocks();
  m.actor = { id: "actor", tenantId: "tenant-a", systemRole: "master", displayName: "원장" };
  m.allowed = true;
  m.beforeWrite = null;
  m.platformIds = new Set();
  m.staff = [STAFF_A, STAFF_B, OPERATOR].map((id) => ({ id, system_role: "admin", status: "active" }));
  m.writes = 0;
  seed("chinsan");
});
afterEach(() => vi.useRealTimers());

describe("급여명세서 관리 — 실제 저장 호환성과 보호", () => {
  const oldForm = (p: PermissionsSettings) => {
    const specialAccess = { ...p.specialAccess };
    delete specialAccess.payslipManagerIds;
    return { ...p, specialAccess };
  };
  it.each(["chinsan", "generic"] as const)("%s legacy viewers materialize without revalidating retired/protected grants", async (preset) => {
    seed(preset, { overrides: [], specialAccess: { payslipViewerIds: [STAFF_B, OPERATOR] } });
    m.platformIds = new Set([OPERATOR]);
    m.staff = [];
    const w = openWindow();
    expect(w.draft.specialAccess.payslipManagerIds).toEqual([STAFF_B, OPERATOR]);
    expect((await w.save({ ...oldForm(w.draft), overrides: [] }))?.ok).toBe(true);
    expect(rawStored().specialAccess).toMatchObject({ payslipManagerIds: [STAFF_B, OPERATOR] });
    const again = openWindow();
    expect((await again.save(again.draft))?.ok).toBe(true);
  });
  it.each([{ viewers: [STAFF_A, STAFF_B] }, { viewers: [] }])("old form viewer add/remove $viewers is rejected with zero mutation", async ({ viewers }) => {
    seed("chinsan", { overrides: [], specialAccess: { payslipViewerIds: [STAFF_A] } });
    const w = openWindow();
    const old = oldForm(w.draft);
    const res = await w.save({ ...old, specialAccess: { ...old.specialAccess, payslipViewerIds: viewers } });
    expect(res?.error).toContain("새로고침");
    expect(m.writes).toBe(0);
    expect(rawStored().specialAccess).not.toHaveProperty("payslipManagerIds");
  });
  it("new UI adds viewer-only, revokes management explicitly, and old unrelated saves keep the revoke", async () => {
    seed("chinsan", { overrides: [], specialAccess: { payslipViewerIds: [STAFF_A] } });
    let w = openWindow();
    expect((await w.save({ ...w.draft, specialAccess: { ...w.draft.specialAccess, payslipViewerIds: [STAFF_A, STAFF_B] } }))?.ok).toBe(true);
    expect(stored().specialAccess.payslipManagerIds).toEqual([STAFF_A]);
    w = openWindow();
    expect((await w.save({ ...w.draft, specialAccess: { ...w.draft.specialAccess, payslipManagerIds: [] } }))?.ok).toBe(true);
    w = openWindow();
    expect((await w.save(oldForm(w.draft)))?.ok).toBe(true);
    expect(rawStored().specialAccess).toMatchObject({ payslipManagerIds: [] });
    w = openWindow();
    expect((await w.save({ ...oldForm(w.draft), specialAccess: { ...oldForm(w.draft).specialAccess, payslipViewerIds: [] } }))?.error).toContain("새로고침");
    expect(stored().specialAccess.payslipManagerIds).toEqual([]);
  });
  it("old form preserves explicit managers even if they have no viewer assignment", async () => {
    seed("generic", { overrides: [], specialAccess: { payslipViewerIds: [], payslipManagerIds: [STAFF_A] } });
    const w = openWindow();
    expect((await w.save(oldForm(w.draft)))?.ok).toBe(true);
    expect(rawStored().specialAccess).toMatchObject({ payslipViewerIds: [], payslipManagerIds: [STAFF_A] });
  });
  it("new marker-only tenant can grant view without granting management", async () => {
    m.row = { data: { version: 1, preset: "generic" }, updated_at: "2026-10-06T00:00:00.000Z" };
    const w = openWindow();
    expect(w.draft.specialAccess.payslipManagerIds).toEqual([]);
    expect((await w.save({ ...w.draft, specialAccess: { ...w.draft.specialAccess, payslipViewerIds: [STAFF_A] } }))?.ok).toBe(true);
    expect(stored().specialAccess.payslipManagerIds).toEqual([]);
  });
  it.each(["foreign", "student", "retired"])("new %s management grant is denied", async (kind) => {
    seed("generic", { overrides: [] });
    m.staff = [{ id: STAFF_B, tenant_id: kind === "foreign" ? "tenant-b" : "tenant-a", system_role: kind === "student" ? "student" : "admin", status: kind === "retired" ? "inactive" : "active" }];
    const w = openWindow();
    expect((await w.save({ ...w.draft, specialAccess: { ...w.draft.specialAccess, payslipManagerIds: [STAFF_B] } }))?.error).toContain("재직 직원");
    expect(m.writes).toBe(0);
  });
  it("protected management cannot be added or revoked, including legacy materialization", async () => {
    m.platformIds = new Set([OPERATOR]);
    seed("chinsan", { overrides: [], specialAccess: { payslipViewerIds: [OPERATOR] } });
    let w = openWindow();
    expect((await w.save({ ...w.draft, specialAccess: { ...w.draft.specialAccess, payslipManagerIds: [] } }))?.error).toBeTruthy();
    expect(m.writes).toBe(0);
    expect((await w.save(w.draft))?.ok).toBe(true);
    seed("chinsan", { overrides: [], specialAccess: { payslipViewerIds: [OPERATOR], payslipManagerIds: [] } });
    w = openWindow();
    const writes = m.writes;
    expect((await w.save({ ...w.draft, specialAccess: { ...w.draft.specialAccess, payslipManagerIds: [OPERATOR] } }))?.error).toBeTruthy();
    expect(m.writes).toBe(writes);
  });
  it.each([null, "bad", ["not-a-uuid"], [STAFF_A, STAFF_A]].map((value) => ({ value })))("explicit malformed $value save is rejected without mutation", async ({ value }) => {
    const w = openWindow();
    expect((await w.save({ ...w.draft, specialAccess: { ...w.draft.specialAccess, payslipManagerIds: value } }))?.error).toBeTruthy();
    expect(m.writes).toBe(0);
  });
});

describe("기준 token이 있어야 저장한다", () => {
  it("🔴 기준 없이 온 저장(배포 전에 열어 둔 화면 · 직접 만든 요청)은 받지 않는다", async () => {
    const w = openWindow();
    expect((await w.save({ ...w.draft, overrides: [] }, null))?.error).toBe(STALE_FORM_ERROR);
    expect((await w.save({ ...w.draft, overrides: [] }, ""))?.error).toBe(STALE_FORM_ERROR);
    expect(m.writes).toBe(0);
    expect(stored().overrides).toEqual(START.overrides);
  });

  it("연 뒤 아무도 안 바꿨으면 저장한다", async () => {
    const w = openWindow();
    const res = await w.save({ ...w.draft, overrides: [{ menu: "staff", role: "teacher", access: "full" }] });
    expect(res?.ok).toBe(true);
    expect(stored().overrides).toEqual([{ menu: "staff", role: "teacher", access: "full" }]);
    expect(stored().userOverrides).toEqual(START.userOverrides);
  });

  it("기준이 맞아도 원장이 아니면 저장하지 못한다 — token은 권한 근거가 아니다", async () => {
    const w = openWindow();
    m.actor = { ...m.actor, systemRole: "admin" };
    expect((await w.save(w.draft))?.error).toContain("원장");
    expect(m.writes).toBe(0);
  });
});

describe("🔴 연 뒤 다른 곳이 바꿨으면 저장하지 않는다 — 그 변경을 되돌리지 않는다", () => {
  it("운영자 스크립트가 개인별 예외만 바꿨다 → 표만 고친 저장도 거절(개인 예외를 옛 값으로 덮게 된다)", async () => {
    const w = openWindow();
    otherWriter((p) => ({ ...p, userOverrides: [...START.userOverrides, { userId: STAFF_B, menu: "billing", access: "readonly" }] }));
    const res = await w.save({ ...w.draft, overrides: [{ menu: "staff", role: "teacher", access: "full" }] });
    expect(res?.error).toBe(CHANGED_ELSEWHERE_ERROR);
    expect(m.writes).toBe(0);
    expect(stored().userOverrides).toHaveLength(2);
  });

  it("'역할 설정' 대화상자가 직급을 바꿨다 → 옛 표의 저장을 거절하고 대화상자의 변경이 남는다", async () => {
    const w = openWindow();
    // 다른 화면의 대화상자가 '운영 설정'의 관리자 체크를 뒤집었다(대화상자의 저장과 같은 계산).
    const selection = settingRoleSelection("timetable", w.draft.overrides);
    const roles = selection.operations_settings ?? [];
    const afterDialog = applySettingRoles("timetable", w.draft.overrides, {
      ...selection,
      operations_settings: roles.includes("admin") ? roles.filter((role) => role !== "admin") : [...roles, "admin"],
    });
    otherWriter((p) => ({ ...p, overrides: afterDialog, rev: 1 }));
    expect(resolveSettings(m.row!.data, { name: "" }).permissions.overrides).toEqual(afterDialog);
    expect(permissionsToken(stored())).not.toBe(w.baseline);

    expect((await w.save({ ...w.draft, overrides: [{ menu: "staff", role: "teacher", access: "full" }] }))?.error).toBe(CHANGED_ELSEWHERE_ERROR);
    expect(stored().overrides).toEqual(afterDialog);
  });

  it("일반판 — 다른 창이 담당자 명단만 바꿨다 → 거절", async () => {
    seed("generic", { ...START, specialAccess: { payslipViewerIds: [STAFF_A], leaveAdjusterIds: [], classSplitterIds: [], staffSubjectScopes: [] } });
    const w = openWindow();
    otherWriter((p) => ({ ...p, specialAccess: { payslipViewerIds: [STAFF_A], leaveAdjusterIds: [STAFF_B], classSplitterIds: [], staffSubjectScopes: [] } }));
    expect((await w.save({ ...w.draft, overrides: [] }))?.error).toBe(CHANGED_ELSEWHERE_ERROR);
    expect(stored().specialAccess.leaveAdjusterIds).toEqual([STAFF_B]);
  });

  it("거절된 뒤 새로 열면(새 기준) 저장된다", async () => {
    const stale = openWindow();
    otherWriter((p) => ({ ...p, userOverrides: [] }));
    expect((await stale.save(stale.draft))?.error).toBe(CHANGED_ELSEWHERE_ERROR);
    const fresh = openWindow();
    expect((await fresh.save({ ...fresh.draft, overrides: [] }))?.ok).toBe(true);
    expect(stored()).toMatchObject({ overrides: [], userOverrides: [] });
  });

  it("액션이 읽은 뒤·쓰기 직전에 끼어든 변경은 최종 쓰기가 거절한다(수정 표식)", async () => {
    const w = openWindow();
    m.beforeWrite = () => otherWriter((p) => ({ ...p, userOverrides: [] }));
    expect((await w.save({ ...w.draft, overrides: [] }))?.error).toContain("먼저 저장되었습니다");
    expect(stored().overrides).toEqual(START.overrides);
    expect(stored().userOverrides).toEqual([]);
  });
});

describe("🔴 적용하면 같은 표여도, 저장된 줄이 달라졌으면 거절한다 — 앱과 DB가 그 줄을 다르게 읽는다", () => {
  it("연 뒤 다른 곳이 같은 칸을 두 줄로 썼다(앱의 표는 그대로다) → 옛 화면의 저장이 그 줄을 지우지 못한다", async () => {
    const w = openWindow();
    // 앱은 마지막 줄(기본값과 같다)을 쓰니 표는 그대로다. DB의 권한 함수는 먼저 걸리는 줄('없음')을 쓴다.
    const added = [{ menu: "billing", role: "admin", access: "none" }, { menu: "billing", role: "admin", access: MENU_ACCESS.billing.admin }];
    otherWriter((p) => ({ ...p, overrides: [...START.overrides, ...added] }));
    expect(resolveMatrix(stored().overrides)).toEqual(resolveMatrix(w.draft.overrides));

    const res = await w.save({ ...w.draft, overrides: [{ menu: "staff", role: "teacher", access: "full" }] });
    expect(res?.error).toBe(CHANGED_ELSEWHERE_ERROR);
    expect(m.writes).toBe(0);
    expect(stored().overrides).toEqual([...START.overrides, ...added]);
  });

  it("연 뒤 다른 곳이 기본값과 같은 줄을 더 적었다('역할 설정' 대화상자가 그렇게 쓴다) → 거절", async () => {
    const w = openWindow();
    otherWriter((p) => ({ ...p, overrides: [...START.overrides, { menu: "staff", role: "master", access: MENU_ACCESS.staff.master }] }));
    expect(resolveMatrix(stored().overrides)).toEqual(resolveMatrix(w.draft.overrides));
    expect((await w.save({ ...w.draft, overrides: [] }))?.error).toBe(CHANGED_ELSEWHERE_ERROR);
    expect(stored().overrides).toHaveLength(START.overrides.length + 1);
  });

  it("줄의 차례만 바뀐 것은 같은 저장값이다 → 저장된다", async () => {
    seed("chinsan", {
      overrides: [...START.overrides, { menu: "billing", role: "manager", access: "full" }],
      userOverrides: [...START.userOverrides, { userId: STAFF_B, menu: "billing", access: "readonly" }],
    });
    const w = openWindow();
    otherWriter((p) => ({ ...p, overrides: [...(p.overrides as unknown[])].reverse(), userOverrides: [...(p.userOverrides as unknown[])].reverse() }));
    expect((await w.save({ ...w.draft, overrides: [{ menu: "staff", role: "teacher", access: "full" }] }))?.ok).toBe(true);
  });
});

describe("같은 칸(메뉴·직급)을 두 번 지정한 요청", () => {
  it("🔴 받지 않는다 — 어느 줄이 적용될지가 읽는 곳마다 다르다(값이 같아도 거절)", async () => {
    const w = openWindow();
    for (const second of ["full", "none"] as const) {
      const res = await w.save({
        ...w.draft,
        overrides: [{ menu: "billing", role: "admin", access: "none" }, { menu: "billing", role: "admin", access: second }],
      });
      expect(res?.error).toContain("두 번 지정할 수 없습니다");
    }
    expect(m.writes).toBe(0);
    expect(stored().overrides).toEqual(START.overrides);
  });

  it("이미 그렇게 저장돼 있어도(손으로 넣은 값·스크립트) 면은 열리고 저장된다 — 저장하면 표의 값 하나로 정리된다", async () => {
    // 스키마로 막으면 이런 값이 저장된 학원은 역할·권한을 고칠 수 없게 된다 → 요청만 거절하고 저장값은 읽는다.
    seed("chinsan", { ...START, overrides: [...START.overrides, { menu: "billing", role: "admin", access: "none" }, { menu: "billing", role: "admin", access: "readonly" }] });
    const w = openWindow();
    // 화면의 표 = 마지막 줄('읽기'). 화면은 표에서 기본값과 다른 칸만 한 줄씩 보낸다.
    const fromTable = [...START.overrides, { menu: "billing", role: "admin", access: "readonly" }];
    const res = await w.save({ ...w.draft, overrides: fromTable });
    expect(res?.ok).toBe(true);
    expect(stored().overrides).toEqual(fromTable);
    expect(res?.permissions?.token).toBe(permissionsToken(stored()));
  });
});

describe("깨진 저장값", () => {
  it("줄이 null인 저장값에도 저장 액션이 던지지 않는다 — 기준 비교는 값을 돌려주고, 저장은 구조화된 오류로 끝난다", async () => {
    seed("chinsan", { ...START, userOverrides: [...START.userOverrides, null] });
    const fd = new FormData();
    fd.set("section", "permissions");
    fd.set("data", JSON.stringify({ ...START, specialAccess: { payslipViewerIds: [], leaveAdjusterIds: [], classSplitterIds: [], staffSubjectScopes: [] } }));
    // 화면이 받았을 기준(같은 함수) — 깨진 줄을 없는 셈 치지 않는다.
    const broken = resolveSettings(m.row!.data, { name: "" }).permissions;
    expect(() => permissionsToken(broken)).not.toThrow();
    expect(permissionsToken(broken)).not.toBe(permissionsToken({ ...broken, userOverrides: START.userOverrides } as PermissionsSettings));
    fd.set("permissionsBaseline", permissionsToken(broken));
    const res = await call(fd);
    // 뒤따르는 보호 검사가 저장값을 스키마로 읽다 실패한다 — 던지지 않고 안내로 끝나며, 쓰지 않는다.
    expect(res?.error).toBeTruthy();
    expect(m.writes).toBe(0);
  });
});

describe("자기 저장 뒤 재저장", () => {
  it("응답의 token이 다음 저장의 기준이다 — 새로 열지 않고 이어서 저장할 수 있다", async () => {
    const w = openWindow();
    const first = await w.save({ ...w.draft, overrides: [{ menu: "staff", role: "teacher", access: "full" }] });
    expect(first?.ok).toBe(true);
    // 응답의 token = 지금 저장된 값을 다시 읽어 만든 token(화면이 새로 열 때 받는 값과 같다).
    expect(first?.permissions?.token).toBe(permissionsToken(stored()));
    // 옛 기준으로는 더 저장할 수 없다(내 저장도 변경이다).
    expect((await w.save({ ...w.draft, overrides: [] }))?.error).toBe(CHANGED_ELSEWHERE_ERROR);
    const second = await w.save({ ...w.draft, overrides: [] }, first!.permissions!.token);
    expect(second?.ok).toBe(true);
    expect(stored().overrides).toEqual([]);
  });

  it("침산 — 개인별 기능 권한을 저장하고, 응답 token은 그렇게 저장된 값의 것이다(어긋나면 재저장이 막힌다)", async () => {
    const w = openWindow();
    const sent = { ...w.draft, specialAccess: { payslipViewerIds: [STAFF_A], payslipManagerIds: [], leaveAdjusterIds: [], classSplitterIds: [STAFF_B], enrollmentDateEditorIds: [], staffTaskMonitorIds: [], vendorViewerIds: [], jjReportManagerIds: [], beforeClassReportIds: [], withdrawalApproverIds: [], withdrawalDeskIds: [], staffSubjectScopes: [{ userId: STAFF_B, subjects: ["english"] }] } };
    const res = await w.save(sent);
    expect(res?.ok).toBe(true);
    expect(stored().specialAccess).toEqual(sent.specialAccess);
    expect(res?.permissions?.token).toBe(permissionsToken(stored()));
    // 옛 기준으로는 더 저장할 수 없고, 응답의 token으로 이어서 저장한다 — 지정은 그대로 남는다.
    expect((await w.save({ ...w.draft, overrides: [] }))?.error).toBe(CHANGED_ELSEWHERE_ERROR);
    expect((await w.save({ ...stored(), overrides: [] }, res!.permissions!.token))?.ok).toBe(true);
    expect(stored().specialAccess).toEqual(sent.specialAccess);
  });

  it("일반판 — 담당자 명단을 저장하고 이어서 다시 저장한다", async () => {
    seed("generic");
    const w = openWindow();
    const res = await w.save({ ...w.draft, specialAccess: { payslipViewerIds: [STAFF_B], payslipManagerIds: [], leaveAdjusterIds: [STAFF_A], classSplitterIds: [], staffSubjectScopes: [] } });
    expect(res?.ok).toBe(true);
    expect(stored().specialAccess).toEqual({ payslipViewerIds: [STAFF_B], payslipManagerIds: [], leaveAdjusterIds: [STAFF_A], classSplitterIds: [], enrollmentDateEditorIds: [], staffTaskMonitorIds: [], vendorViewerIds: [], jjReportManagerIds: [], beforeClassReportIds: [], withdrawalApproverIds: [], withdrawalDeskIds: [], staffSubjectScopes: [] });
    expect(res?.permissions?.token).toBe(permissionsToken(stored()));
    const again = await w.save({ ...stored(), userOverrides: [] }, res!.permissions!.token);
    expect(again?.ok).toBe(true);
    expect(stored().specialAccess).toEqual({ payslipViewerIds: [STAFF_B], payslipManagerIds: [], leaveAdjusterIds: [STAFF_A], classSplitterIds: [], enrollmentDateEditorIds: [], staffTaskMonitorIds: [], vendorViewerIds: [], jjReportManagerIds: [], beforeClassReportIds: [], withdrawalApproverIds: [], withdrawalDeskIds: [], staffSubjectScopes: [] });
  });
});

describe("저장 순번", () => {
  it("🔴 역할·권한 섹션 **안에** 쓰고 저장마다 1씩 올린다 — 문서 최상위에는 두지 않는다(DB 쓰기 가드가 위임 계정의 저장을 거절한다)", async () => {
    const w = openWindow();
    const first = await w.save({ ...w.draft, overrides: [] });
    expect(first?.version).toBe(1);
    expect(rawStored().rev).toBe(1);
    expect(m.row!.data).not.toHaveProperty("rev");
    const second = await w.save({ ...w.draft, overrides: START.overrides }, first!.permissions!.token);
    expect(second?.version).toBe(2);
    expect(rawStored().rev).toBe(2);
  });

  it("순번은 설정이 아니다 — 풀어 읽은 값과 변경 내역(감사 기록)에 섞이지 않는다", async () => {
    const w = openWindow();
    await w.save({ ...w.draft, overrides: [] });
    expect(stored()).not.toHaveProperty("rev");
    expect(JSON.stringify(m.audit.mock.calls)).not.toContain("rev");
    // 순번만 다른 문서는 같은 설정이다(기준 token이 같다).
    const before = permissionsToken(stored());
    otherWriter((p) => ({ ...p, rev: 41 }));
    expect(permissionsToken(stored())).toBe(before);
  });

  it("다른 섹션의 저장은 역할·권한의 순번을 건드리지 않는다", async () => {
    const w = openWindow();
    await w.save({ ...w.draft, overrides: [] });
    const fd = new FormData();
    fd.set("section", "profile");
    fd.set("data", JSON.stringify(resolveSettings(m.row!.data, { name: "" }).profile));
    expect((await call(fd))?.ok).toBe(true);
    expect(rawStored().rev).toBe(1);
    expect(m.row!.data.profile).not.toHaveProperty("rev");
  });
});

describe("기존 보호는 그대로다", () => {
  it("일반판 — 운영자 계정의 개인 예외를 지우는 저장은 기준이 맞아도 거절한다", async () => {
    seed("generic", { ...START, userOverrides: [...START.userOverrides, { userId: OPERATOR, menu: "staff", access: "full" }] });
    m.platformIds = new Set([OPERATOR]);
    const w = openWindow();
    expect((await w.save({ ...w.draft, userOverrides: START.userOverrides }))?.error).toContain("지점에서 변경할 수 없습니다");
    expect(m.writes).toBe(0);
    // 그대로 전달하면(화면은 숨긴 채 보존한다) 저장된다.
    expect((await w.save({ ...w.draft, overrides: [] }))?.ok).toBe(true);
    expect(stored().userOverrides).toContainEqual({ userId: OPERATOR, menu: "staff", access: "full" });
  });

  it("일반판 — 다른 지점·퇴직 직원은 권한 대상으로 받지 않는다", async () => {
    seed("generic");
    m.staff = m.staff.filter((u) => u.id !== STAFF_B);
    const w = openWindow();
    const res = await w.save({ ...w.draft, userOverrides: [...START.userOverrides, { userId: STAFF_B, menu: "billing", access: "full" }] });
    expect(res?.error).toContain("재직 직원");
    expect(m.writes).toBe(0);
  });

  it("스키마가 막는 값(원장의 설정 접근 잠금)은 기준이 맞아도 저장하지 않는다", async () => {
    const w = openWindow();
    const res = await w.save({ ...w.draft, overrides: [{ menu: "owner", role: "master", access: "none" }] });
    expect(res?.error).toBeTruthy();
    expect(m.writes).toBe(0);
  });
});

describe("개인별 기능 권한 — 어느 학원에서나 화면에서 지정한다(원장 2026-10-06)", () => {
  it("수강 날짜 수정 지정·해제와 옛 폼 보존·신규 직원 검증이 함께 동작한다", async () => {
    const w = openWindow();
    const next = { ...w.draft, specialAccess: { ...w.draft.specialAccess, enrollmentDateEditorIds: [STAFF_A] } };
    const res = await w.save(next);
    expect(res?.ok).toBe(true);
    expect(stored().specialAccess.enrollmentDateEditorIds).toEqual([STAFF_A]);
    expect(res?.permissions?.token).toBe(permissionsToken(stored()));
    const old = openWindow();
    const legacy = { ...old.draft.specialAccess }; delete legacy.enrollmentDateEditorIds;
    expect((await old.save({ ...old.draft, specialAccess: legacy }))?.ok).toBe(true);
    expect(stored().specialAccess.enrollmentDateEditorIds).toEqual([STAFF_A]);
    const clear = openWindow();
    expect((await clear.save({ ...clear.draft, specialAccess: { ...clear.draft.specialAccess, enrollmentDateEditorIds: [] } }))?.ok).toBe(true);
    expect(stored().specialAccess.enrollmentDateEditorIds).toEqual([]);
    const bad = openWindow();
    expect((await bad.save({ ...bad.draft, specialAccess: { ...bad.draft.specialAccess, enrollmentDateEditorIds: ["77777777-7777-4777-8777-777777777777"] } }))?.error).toContain("재직 직원");
  });
  const none = { payslipViewerIds: [], payslipManagerIds: [], leaveAdjusterIds: [], classSplitterIds: [], enrollmentDateEditorIds: [], staffTaskMonitorIds: [], vendorViewerIds: [], jjReportManagerIds: [], beforeClassReportIds: [], withdrawalApproverIds: [], withdrawalDeskIds: [], staffSubjectScopes: [] };

  it("🔴 새로 지정하는 사람은 지금 이 학원의 재직 직원이어야 한다 — 칸마다 본다", async () => {
    seed("chinsan");
    m.staff = m.staff.filter((u) => u.id !== STAFF_B);
    const w = openWindow();
    for (const special of [
      { ...none, payslipViewerIds: [STAFF_B] },
      { ...none, leaveAdjusterIds: [STAFF_B] },
      { ...none, classSplitterIds: [STAFF_B] },
      { ...none, withdrawalDeskIds: [STAFF_B] },
      { ...none, staffSubjectScopes: [{ userId: STAFF_B, subjects: ["math"] }] },
    ]) {
      expect((await w.save({ ...w.draft, specialAccess: special }))?.error).toContain("재직 직원");
    }
    expect(m.writes).toBe(0);
  });

  it("🔴 이미 지정돼 있던 사람은 퇴직했어도 다른 저장을 막지 않는다 — 다른 칸에 새로 넣는 것만 막는다", async () => {
    seed("chinsan", { ...START, specialAccess: { ...none, payslipViewerIds: [STAFF_B] } });
    m.staff = m.staff.filter((u) => u.id !== STAFF_B);
    const w = openWindow();
    expect((await w.save({ ...w.draft, overrides: [] }))?.ok).toBe(true);
    expect(stored().specialAccess.payslipViewerIds).toEqual([STAFF_B]);
    const again = openWindow();
    expect((await again.save({ ...again.draft, specialAccess: { ...again.draft.specialAccess, classSplitterIds: [STAFF_B] } }))?.error).toContain("재직 직원");
    // 거두는 것은 된다.
    expect((await again.save({ ...again.draft, specialAccess: none }))?.ok).toBe(true);
    expect(stored().specialAccess.payslipViewerIds).toEqual([]);
  });

  it("🔴 과목 범위에는 학원 설정에 있는 과목만 — 없는 과목은 그 사람에게 직원이 한 명도 안 보이게 만든다", async () => {
    seed("chinsan");
    const w = openWindow();
    const res = await w.save({ ...w.draft, specialAccess: { ...none, staffSubjectScopes: [{ userId: STAFF_B, subjects: ["math", "no_such_subject"] }] } });
    expect(res?.error).toContain("학원 설정에 있는 과목");
    expect(m.writes).toBe(0);
  });

  it("이미 저장돼 있던 범위는 그 과목이 없어졌어도 다른 저장을 막지 않는다", async () => {
    const scopes = [{ userId: STAFF_B, subjects: ["no_such_subject"] }];
    seed("chinsan", { ...START, specialAccess: { ...none, staffSubjectScopes: scopes } });
    const w = openWindow();
    expect((await w.save({ ...w.draft, overrides: [] }))?.ok).toBe(true);
    expect(stored().specialAccess.staffSubjectScopes).toEqual(scopes);
  });

  it("🔴 새 학원(일반판)도 같다 — 범위의 과목이 없어졌거나(과목 흡수) 지정한 사람이 퇴직해도 역할 표 저장이 막히지 않는다", async () => {
    const special = { ...none, payslipViewerIds: [STAFF_B], staffSubjectScopes: [{ userId: STAFF_B, subjects: ["no_such_subject"] }] };
    seed("generic", { ...START, specialAccess: special });
    m.staff = m.staff.filter((u) => u.id !== STAFF_B);
    const w = openWindow();
    expect((await w.save({ ...w.draft, overrides: [] }))?.ok).toBe(true);
    expect(stored().specialAccess).toEqual(special);
    // 새로 지정하는 것은 일반판에서도 본다.
    const again = openWindow();
    expect((await again.save({ ...again.draft, specialAccess: { ...again.draft.specialAccess, leaveAdjusterIds: [STAFF_B] } }))?.error).toContain("재직 직원");
  });

  it("🔴 이 코드가 모르는 저장 칸(더 새 판이 만든 칸)은 저장해도 남는다 — 되돌린 배포가 지우지 않는다", async () => {
    seed("chinsan", { ...START, specialAccess: { ...none, classSplitterIds: [STAFF_B], futureKeyIds: [STAFF_A] } });
    const w = openWindow();
    expect((await w.save({ ...w.draft, specialAccess: { ...none, classSplitterIds: [STAFF_B], leaveAdjusterIds: [STAFF_A] } }))?.ok).toBe(true);
    expect(rawStored().specialAccess).toEqual({ ...none, classSplitterIds: [STAFF_B], leaveAdjusterIds: [STAFF_A], futureKeyIds: [STAFF_A] });
  });

  it("🔴 새 칸을 모르는 옛 화면의 저장이 지정해 둔 사람을 지우지 않는다", async () => {
    const special = { ...none, classSplitterIds: [STAFF_B], staffSubjectScopes: [{ userId: STAFF_B, subjects: ["math"] }] };
    seed("chinsan", { ...START, specialAccess: special });
    const w = openWindow();
    // 옛 화면은 담당자 두 칸만 안다(그 둘은 화면에 있던 값 그대로 보낸다).
    const res = await w.save({ overrides: [], userOverrides: w.draft.userOverrides, specialAccess: { payslipViewerIds: [], leaveAdjusterIds: [] } });
    expect(res?.ok).toBe(true);
    expect(stored().specialAccess).toEqual(special);
  });

  it("운영자 계정의 지정은 지우거나 더할 수 없다(그대로 실어 보내면 저장된다)", async () => {
    seed("chinsan", { ...START, specialAccess: { ...none, classSplitterIds: [OPERATOR] } });
    m.platformIds = new Set([OPERATOR]);
    const w = openWindow();
    expect((await w.save({ ...w.draft, specialAccess: none }))?.error).toBeTruthy();
    expect(m.writes).toBe(0);
    expect((await w.save({ ...w.draft, specialAccess: { ...w.draft.specialAccess, classSplitterIds: [OPERATOR, STAFF_B] } }))?.ok).toBe(true);
    expect(stored().specialAccess.classSplitterIds).toEqual([OPERATOR, STAFF_B]);
  });
});

describe("침산 — 개인별 메뉴 권한을 화면에서 준다(원장 2026-10-06)", () => {
  it("재직 직원에게 새로 주는 줄은 저장된다 — 역할 표와 함께 한 번에", async () => {
    seed("chinsan");
    const w = openWindow();
    const res = await w.save({ ...w.draft, userOverrides: [...START.userOverrides, { userId: STAFF_B, menu: "billing", access: "readonly" }] });
    expect(res?.ok).toBe(true);
    expect(stored().userOverrides).toContainEqual({ userId: STAFF_B, menu: "billing", access: "readonly" });
    expect(stored().overrides).toEqual(START.overrides);
  });

  it("🔴 다른 지점·퇴직 직원에게 새로 주는 줄은 받지 않는다 — 침산도 대상을 확인한다", async () => {
    seed("chinsan");
    m.staff = m.staff.filter((u) => u.id !== STAFF_B);
    const w = openWindow();
    const res = await w.save({ ...w.draft, userOverrides: [...START.userOverrides, { userId: STAFF_B, menu: "billing", access: "full" }] });
    expect(res?.error).toContain("재직 직원");
    expect(m.writes).toBe(0);
  });

  it("🔴 이미 저장돼 있던 줄은 그 사람이 퇴직했어도 다른 저장을 막지 않는다(그 줄을 바꾸는 것만 막는다)", async () => {
    seed("chinsan");
    m.staff = m.staff.map((u) => (u.id === STAFF_A ? { ...u, status: "inactive" } : u));
    const w = openWindow();
    // 역할 표만 고친 저장 — 퇴직자의 줄은 그대로 실려 간다.
    expect((await w.save({ ...w.draft, overrides: [] }))?.ok).toBe(true);
    expect(stored().userOverrides).toEqual(START.userOverrides);
    // 그 줄의 값을 바꾸는 것은 새로 주는 것과 같다 → 거절.
    const again = openWindow();
    const res = await again.save({ ...again.draft, userOverrides: [{ userId: STAFF_A, menu: "staff", access: "readonly" }] });
    expect(res?.error).toContain("재직 직원");
    // 거두는 것은 된다.
    expect((await again.save({ ...again.draft, userOverrides: [] }))?.ok).toBe(true);
    expect(stored().userOverrides).toEqual([]);
  });

  it("역할 전용 화면처럼 잠긴 칸은 개인에게도 줄 수 없다", async () => {
    seed("chinsan");
    m.staff = m.staff.map((u) => (u.id === STAFF_B ? { ...u, system_role: "teacher" } : u));
    const w = openWindow();
    const res = await w.save({ ...w.draft, userOverrides: [...START.userOverrides, { userId: STAFF_B, menu: "dashboard", access: "full" }] });
    expect(res?.error).toContain("잠긴 메뉴 권한");
    expect(m.writes).toBe(0);
  });

  it("운영자 계정의 줄은 침산에서도 지우거나 더할 수 없다(그대로 실어 보내면 저장된다)", async () => {
    seed("chinsan", { ...START, userOverrides: [...START.userOverrides, { userId: OPERATOR, menu: "staff", access: "full" }] });
    m.platformIds = new Set([OPERATOR]);
    const w = openWindow();
    expect((await w.save({ ...w.draft, userOverrides: START.userOverrides }))?.error).toContain("지점에서 변경할 수 없습니다");
    expect(m.writes).toBe(0);
    expect((await w.save({ ...w.draft, userOverrides: [{ userId: OPERATOR, menu: "staff", access: "full" }] }))?.ok).toBe(true);
    expect(stored().userOverrides).toEqual([{ userId: OPERATOR, menu: "staff", access: "full" }]);
  });
});


describe("student status actual settings saves", () => {
  it("blocks legacy students menu changes until explicit transition", async () => {
    seed("generic", { overrides: [], userOverrides: [], specialAccess: {} });
    const w = openWindow();
    const next = { ...w.draft, userOverrides: [{ userId: STAFF_A, menu: "students", access: "full" }] };
    expect((await w.save(next))?.error).toBeTruthy(); expect(m.writes).toBe(0);
    expect((await w.save({ ...next, specialAccess: { ...w.draft.specialAccess, studentStatusManagerIds: [STAFF_A] } }))?.ok).toBe(true);
    expect(stored().specialAccess.studentStatusManagerIds).toEqual([STAFF_A]);
  });
  it("preserves explicit empty when an old form omits the field", async () => {
    seed("generic", { overrides: [], specialAccess: { studentStatusManagerIds: [] } });
    const w = openWindow(); const specialAccess = { ...w.draft.specialAccess }; delete specialAccess.studentStatusManagerIds;
    expect((await w.save({ ...w.draft, specialAccess }))?.ok).toBe(true);
    expect(rawStored().specialAccess).toMatchObject({ studentStatusManagerIds: [] });
    expect(openWindow().draft.specialAccess.studentStatusManagerIds).toEqual([]);
  });
  it("rejects new inactive grants, malformed values, and hidden account changes without mutation", async () => {
    seed("generic", { overrides: [], specialAccess: { studentStatusManagerIds: [] } });
    const w = openWindow(); m.staff = [];
    expect((await w.save({ ...w.draft, specialAccess: { ...w.draft.specialAccess, studentStatusManagerIds: [STAFF_A] } }))?.error).toBeTruthy();
    m.staff = [{ id: OPERATOR, system_role: "admin", status: "active" }]; m.platformIds = new Set([OPERATOR]);
    expect((await w.save({ ...w.draft, specialAccess: { ...w.draft.specialAccess, studentStatusManagerIds: [OPERATOR] } }))?.error).toBeTruthy();
    expect((await w.save({ ...w.draft, specialAccess: { ...w.draft.specialAccess, studentStatusManagerIds: null } }))?.error).toBeTruthy();
    expect(m.writes).toBe(0);
  });
});

describe("강사보다 낮은 직급(열람·아르바이트)의 '담당' — 원장 2026-11-05 금지 · 저장된 값이 이 면을 막지 않는다(리뷰 2026-11-05)", () => {
  const PART = { id: STAFF_A, system_role: "parttime", status: "active" };
  /** 화면이 보내는 것과 같은 모양 — 표(resolveMatrix: 저장된 금지 '담당'은 '읽기' — 그 칸 기본값이 '없음'이면 '없음' — 로 내림) → 기본값과 다른 칸만 + 개인·담당자 그대로. */
  const asForm = (p: PermissionsSettings) => ({ overrides: sparseRoleOverrides(resolveMatrix(p.overrides)), userOverrides: p.userOverrides, specialAccess: p.specialAccess });

  it.each(["chinsan", "generic"] as const)("🔴 %s: 저장돼 있던 역할 칸 '담당'(손으로 넣은 값)이 있어도 화면 그대로 저장된다 — '읽기'(기본값이 '없음'이면 '없음')로 정리된다", async (preset) => {
    // 아르바이트 출석부 기본값 '없음' · 열람 출석부 기본값 '읽기' · 열람 원생 칸은 '전체'로 열어 둔 뒤 옛 '담당'이 덮었던 경우.
    seed(preset, { overrides: [{ menu: "attendance", role: "parttime", access: "scoped" }, { menu: "attendance", role: "viewer", access: "scoped" }, { menu: "students", role: "viewer", access: "full" }, { menu: "students", role: "viewer", access: "scoped" }], userOverrides: [] });
    const w = openWindow();
    const res = await w.save(asForm(w.draft));
    expect(res?.ok, JSON.stringify(res)).toBe(true);
    expect(stored().overrides.some((o) => isScopedForbiddenRole(o.role) && o.access === "scoped")).toBe(false);
    const after = resolveMatrix(stored().overrides);
    expect(after.attendance.parttime).toBe("none"); // '읽기'로 올리면 그 칸이 처음 열린다
    expect(after.attendance.viewer).toBe("readonly");
    expect(after.students.viewer).toBe("readonly"); // 버리면 앞 줄의 '전체'가 된다
  });

  it.each(["chinsan", "generic"] as const)("🔴 %s: 요청에 실린 역할 칸 '담당'은 같은 안내 문구로 거절(화면을 거치지 않은 요청)", async (preset) => {
    seed(preset, { overrides: [], userOverrides: [] });
    const w = openWindow();
    const res = await w.save({ ...asForm(w.draft), overrides: [{ menu: "attendance", role: "viewer", access: "scoped" }] });
    expect(res?.error).toBe(SCOPED_FORBIDDEN_MESSAGE);
    expect(m.writes).toBe(0);
    // 강사의 '담당'은 된다.
    expect((await w.save({ ...asForm(w.draft), overrides: [{ menu: "attendance", role: "teacher", access: "scoped" }] }))?.ok).toBe(true);
  });

  it.each(["chinsan", "generic"] as const)("🔴 %s: 역할이 바뀌어 남은 옛 '담당' 개인 줄은 그대로 두고 저장된다(일반판도 — 그 줄 하나로 면 전체가 막히던 것)", async (preset) => {
    seed(preset, { overrides: [], userOverrides: [{ userId: STAFF_A, menu: "attendance", access: "scoped" }] });
    m.staff = [PART];
    const w = openWindow();
    const res = await w.save(asForm(w.draft));
    expect(res?.ok, JSON.stringify(res)).toBe(true);
    expect(stored().userOverrides).toEqual([{ userId: STAFF_A, menu: "attendance", access: "scoped" }]);
    // 적용: 역할 칸이 '전체'면 '읽기'(버리면 역할 값으로 넓어진다) · 역할 칸이 기본값 '없음'이면 '없음'('읽기'로 올리면 처음 열린다).
    const matrix = resolveMatrix([{ menu: "attendance", role: "parttime", access: "full" }]);
    expect(applyUserOverrides(matrix, STAFF_A, "parttime", stored().userOverrides).attendance.parttime).toBe("readonly");
    expect(applyUserOverrides(resolveMatrix(stored().overrides), STAFF_A, "parttime", stored().userOverrides).attendance.parttime).toBe("none");
  });

  it.each(["chinsan", "generic"] as const)("🔴 %s: 새로 주거나 다른 수준에서 '담당'으로 바꾸는 개인 줄은 같은 안내 문구로 거절", async (preset) => {
    seed(preset, { overrides: [], userOverrides: [{ userId: STAFF_A, menu: "students", access: "readonly" }] });
    m.staff = [PART];
    const w = openWindow();
    expect((await w.save({ ...asForm(w.draft), userOverrides: [...w.draft.userOverrides, { userId: STAFF_A, menu: "attendance", access: "scoped" }] }))?.error).toBe(SCOPED_FORBIDDEN_MESSAGE);
    expect((await w.save({ ...asForm(w.draft), userOverrides: [{ userId: STAFF_A, menu: "students", access: "scoped" }] }))?.error).toBe(SCOPED_FORBIDDEN_MESSAGE);
    expect(m.writes).toBe(0);
  });
});

describe("연결 앱 권한 — 전체·없음만(원장 2026-11-05) · 저장된 값이 이 면을 막지 않는다", () => {
  const asForm = (p: PermissionsSettings) => ({ overrides: sparseRoleOverrides(resolveMatrix(p.overrides)), userOverrides: p.userOverrides, specialAccess: p.specialAccess });

  it.each(["chinsan", "generic"] as const)("🔴 %s: 요청에 실린 연결 앱 '담당'·'읽기'는 거절(역할 칸 · 새 개인 줄 — 화면을 거치지 않은 요청)", async (preset) => {
    seed(preset, { overrides: [], userOverrides: [] });
    const w = openWindow();
    for (const access of ["scoped", "readonly"] as const) {
      expect((await w.save({ ...asForm(w.draft), overrides: [{ menu: "app_todays_math", role: "teacher", access }] }))?.error, access).toBe(CONNECTED_APP_ACCESS_MESSAGE);
      expect((await w.save({ ...asForm(w.draft), userOverrides: [{ userId: STAFF_A, menu: "app_todays_math", access }] }))?.error, access).toBe(CONNECTED_APP_ACCESS_MESSAGE);
    }
    expect(m.writes).toBe(0);
    // 전체·없음은 된다(역할 칸 · 개인 줄).
    const res = await w.save({ ...asForm(w.draft), overrides: [{ menu: "app_todays_math", role: "teacher", access: "none" }], userOverrides: [{ userId: STAFF_A, menu: "app_todays_math", access: "full" }] });
    expect(res?.ok, JSON.stringify(res)).toBe(true);
  });

  it.each(["chinsan", "generic"] as const)("🔴 %s: 열람·아르바이트의 연결 앱 '담당'도 연결 앱 문구로 거절('읽기'를 고르라는 '담당' 금지 문구가 아니다 — 재리뷰 2026-11-06)", async (preset) => {
    seed(preset, { overrides: [], userOverrides: [] });
    m.staff = [{ id: STAFF_A, system_role: "parttime", status: "active" }];
    const w = openWindow();
    expect((await w.save({ ...asForm(w.draft), overrides: [{ menu: "app_todays_math", role: "viewer", access: "scoped" }] }))?.error).toBe(CONNECTED_APP_ACCESS_MESSAGE);
    expect((await w.save({ ...asForm(w.draft), userOverrides: [{ userId: STAFF_A, menu: "app_todays_math", access: "scoped" }] }))?.error).toBe(CONNECTED_APP_ACCESS_MESSAGE);
    expect(m.writes).toBe(0);
  });

  it.each(["chinsan", "generic"] as const)("🔴 %s: 저장돼 있던 연결 앱 '담당'·'읽기'(손으로 넣은 값)가 있어도 화면 그대로 저장된다 — 그 칸은 적용하지 않는다", async (preset) => {
    seed(preset, {
      overrides: [{ menu: "app_todays_math", role: "manager", access: "readonly" }, { menu: "app_todays_math", role: "viewer", access: "scoped" }],
      userOverrides: [{ userId: STAFF_A, menu: "app_todays_math", access: "readonly" }],
    });
    const w = openWindow();
    const res = await w.save(asForm(w.draft));
    expect(res?.ok, JSON.stringify(res)).toBe(true);
    // 역할 칸은 화면이 적용되는 표(그 칸 = 기본값)로 다시 써 정리된다 · 개인 줄은 손대지 않고 그대로 남는다(적용 단계가 건너뛴다).
    expect(stored().overrides.some((o) => o.menu === "app_todays_math")).toBe(false);
    expect(stored().userOverrides).toEqual([{ userId: STAFF_A, menu: "app_todays_math", access: "readonly" }]);
    expect(applyUserOverrides(resolveMatrix(stored().overrides), STAFF_A, "admin", stored().userOverrides).app_todays_math.admin).toBe(MENU_ACCESS.app_todays_math.admin);
  });
});

describe("학원 비서 권한 — 전체·없음만 · 강사 칸 잠금(2026-11-09)", () => {
  const asForm = (p: PermissionsSettings) => ({ overrides: sparseRoleOverrides(resolveMatrix(p.overrides)), userOverrides: p.userOverrides, specialAccess: p.specialAccess });

  it.each(["chinsan", "generic"] as const)("🔴 %s: 요청에 실린 학원 비서 '담당'·'읽기'는 학원 비서 문구로 거절(역할 칸 · 새 개인 줄)", async (preset) => {
    seed(preset, { overrides: [], userOverrides: [] });
    const w = openWindow();
    for (const access of ["scoped", "readonly"] as const) {
      // 지금은 원장 밖에 잠겨 있어 잠금 문구가 먼저다(2026-11-12 임시 · '전체'로 다시 보내도 막히므로 '전체·없음을 고르라'고 하지 않는다).
      expect((await w.save({ ...asForm(w.draft), overrides: [{ menu: "assistant", role: "admin", access }] }))?.error, access).toBe("이 역할에서 잠긴 메뉴 권한은 변경할 수 없습니다");
      expect((await w.save({ ...asForm(w.draft), userOverrides: [{ userId: STAFF_A, menu: "assistant", access }] }))?.error, access).toBe("이 역할에서 잠긴 메뉴 권한은 변경할 수 없습니다");
    }
    expect(onOffAccessMessage("assistant")).toBe("학원 비서 권한은 전체·없음 중에서 선택해 주세요");
    expect(m.writes).toBe(0);
    // 지금은 원장만(2026-11-12 임시) — 원장 아닌 역할 칸의 '전체'도 잠금 문구로 거절(옛 화면이 '저장만 되는 칸'을 남기지 않게).
    expect((await w.save({ ...asForm(w.draft), overrides: [{ menu: "assistant", role: "admin", access: "full" }] }))?.error).toBe("이 역할에서 잠긴 메뉴 권한은 변경할 수 없습니다");
    expect((await w.save({ ...asForm(w.draft), userOverrides: [{ userId: STAFF_A, menu: "assistant", access: "full" }] }))?.error).toBe("이 역할에서 잠긴 메뉴 권한은 변경할 수 없습니다");
    expect(m.writes).toBe(0);
  });

  it.each(["chinsan", "generic"] as const)("🔴 %s: 강사에게 새로 주는 개인 줄은 잠금 문구로 거절 — 강사 화면엔 비서 단추가 없다", async (preset) => {
    seed(preset, { overrides: [], userOverrides: [] });
    m.staff = [{ id: STAFF_A, system_role: "teacher", status: "active" }];
    const w = openWindow();
    expect((await w.save({ ...asForm(w.draft), userOverrides: [{ userId: STAFF_A, menu: "assistant", access: "full" }] }))?.error).toBe("이 역할에서 잠긴 메뉴 권한은 변경할 수 없습니다");
    expect(m.writes).toBe(0);
  });

  it.each(["chinsan", "generic"] as const)("%s: 그 뒤 강사가 된 사람의 저장된 학원 비서 줄이 있어도 이 면은 저장된다 — 그 줄은 적용하지 않는다", async (preset) => {
    seed(preset, { overrides: [], userOverrides: [{ userId: STAFF_A, menu: "assistant", access: "full" }] });
    m.staff = [{ id: STAFF_A, system_role: "teacher", status: "active" }];
    const w = openWindow();
    const res = await w.save(asForm(w.draft));
    expect(res?.ok, JSON.stringify(res)).toBe(true);
    expect(applyUserOverrides(resolveMatrix(stored().overrides), STAFF_A, "teacher", stored().userOverrides).assistant.teacher).toBe("none");
  });
});

/**
 * 조직·OKR · 업무 작성센터 — 직원 역할 여섯만 쓰는 화면이라 열람·아르바이트 칸을 잠근다(2026-11-11 · permissions.ts `isStaffRecordLocked`).
 * 잠금을 더해도 **이미 저장된 설정이 이 면의 저장을 막지 않는다** — 침산이 배포 뒤 저장할 다섯 칸도 그대로 저장된다.
 */
describe("조직·OKR · 업무 작성센터 — 열람·아르바이트 칸 잠금(2026-11-11) · 저장된 값이 이 면을 막지 않는다", () => {
  const asForm = (p: PermissionsSettings) => ({ overrides: sparseRoleOverrides(resolveMatrix(p.overrides)), userOverrides: p.userOverrides, specialAccess: p.specialAccess });
  const PART = { id: STAFF_A, system_role: "parttime", status: "active" };

  it.each(["chinsan", "generic"] as const)("%s: 배포 뒤 저장할 다섯 칸(조직·OKR·업무 작성센터 × 관리자·매니저 '전체' · 신규생 관리 × 강사 '담당')은 저장되고 그대로 적용된다", async (preset) => {
    seed(preset, { overrides: [{ menu: "documents", role: "teacher", access: "none" }], userOverrides: [] });
    const w = openWindow();
    const wanted = [
      ...(["okr", "work_records"] as const).flatMap((menu) => (["admin", "manager"] as const).map((role) => ({ menu, role, access: "full" as const }))),
      { menu: "newcomers" as const, role: "teacher" as const, access: "scoped" as const },
    ];
    const res = await w.save({ ...asForm(w.draft), overrides: [...asForm(w.draft).overrides, ...wanted] });
    expect(res?.ok, JSON.stringify(res)).toBe(true);
    const after = resolveMatrix(stored().overrides);
    for (const c of wanted) expect(after[c.menu][c.role], `${c.menu}·${c.role}`).toBe(c.access);
    // 손대지 않은 칸은 그대로다(코드 기본값 · 이미 저장돼 있던 칸).
    expect(after.okr.teacher).toBe("none");
    expect(after.work_records.viewer).toBe("none");
    expect(after.management).toEqual(MENU_ACCESS.management);
    expect(after.documents.teacher).toBe("none");
  });

  it.each(["chinsan", "generic"] as const)("🔴 %s: 저장돼 있던 열람·아르바이트 칸(손으로 넣은 값)이 있어도 화면 그대로 저장된다 — 그 칸은 적용하지 않고 정리된다", async (preset) => {
    seed(preset, { overrides: [{ menu: "okr", role: "viewer", access: "readonly" }, { menu: "work_records", role: "parttime", access: "full" }, { menu: "okr", role: "admin", access: "full" }], userOverrides: [] });
    expect(resolveMatrix(stored().overrides).okr.viewer).toBe("none");
    const w = openWindow();
    const res = await w.save(asForm(w.draft));
    expect(res?.ok, JSON.stringify(res)).toBe(true);
    expect(stored().overrides).toEqual([{ menu: "okr", role: "admin", access: "full" }]);
  });

  it.each(["chinsan", "generic"] as const)("🔴 %s: 열람·아르바이트 **역할 칸**을 새로 여는 요청도 거절한다(화면은 그 칸을 '고정'으로 세운다 — 만든 요청만 온다) · 직원 역할 칸은 된다", async (preset) => {
    seed(preset, { overrides: [], userOverrides: [] });
    const w = openWindow();
    const form = asForm(w.draft);
    for (const cell of [
      { menu: "okr", role: "viewer", access: "full" },
      { menu: "work_records", role: "parttime", access: "readonly" },
      { menu: "okr", role: "parttime", access: "none" },
      // '담당'이어도 잠금 문구다 — '읽기를 고르라'는 안내를 내면 다시 보낸 '읽기'도 거절된다.
      { menu: "work_records", role: "viewer", access: "scoped" },
    ] as const) {
      expect((await w.save({ ...form, overrides: [...form.overrides, cell] }))?.error, `${cell.menu}·${cell.role}`).toBe("이 역할에서 잠긴 메뉴 권한은 변경할 수 없습니다");
    }
    expect(m.writes).toBe(0);
    expect(stored().overrides).toEqual([]);
    // 직원 역할 여섯의 칸은 그대로 된다(상담·회계도 서버가 받는 역할이다).
    const ok = await w.save({ ...form, overrides: [...form.overrides, { menu: "okr", role: "counselor", access: "scoped" }, { menu: "work_records", role: "accountant", access: "full" }] });
    expect(ok?.ok, JSON.stringify(ok)).toBe(true);
  });

  it.each(["chinsan", "generic"] as const)("🔴 %s: 열람·아르바이트에게 새로 주는 개인 줄은 잠금 문구로 거절 — 서버가 그 역할을 받지 않는 화면이다", async (preset) => {
    seed(preset, { overrides: [], userOverrides: [] });
    m.staff = [PART];
    const w = openWindow();
    for (const menu of ["okr", "work_records"] as const) {
      for (const access of ["full", "scoped", "readonly"] as const) {
        expect((await w.save({ ...asForm(w.draft), userOverrides: [{ userId: STAFF_A, menu, access }] }))?.error, `${menu}·${access}`).toBe("이 역할에서 잠긴 메뉴 권한은 변경할 수 없습니다");
      }
    }
    expect(m.writes).toBe(0);
    // 강사·관리자에게 주는 개인 줄은 된다.
    m.staff = [{ id: STAFF_A, system_role: "teacher", status: "active" }];
    expect((await w.save({ ...asForm(w.draft), userOverrides: [{ userId: STAFF_A, menu: "okr", access: "scoped" }] }))?.ok).toBe(true);
  });

  it.each(["chinsan", "generic"] as const)("%s: 준 뒤 열람·아르바이트가 된 사람의 저장된 줄이 있어도 이 면은 저장된다 — 그 줄은 적용하지 않는다", async (preset) => {
    seed(preset, { overrides: [], userOverrides: [{ userId: STAFF_A, menu: "work_records", access: "scoped" }] });
    m.staff = [PART];
    const w = openWindow();
    const res = await w.save({ ...asForm(w.draft), overrides: [{ menu: "okr", role: "admin", access: "full" }] });
    expect(res?.ok, JSON.stringify(res)).toBe(true);
    expect(stored().userOverrides).toEqual([{ userId: STAFF_A, menu: "work_records", access: "scoped" }]);
    expect(applyUserOverrides(resolveMatrix(stored().overrides), STAFF_A, "parttime", stored().userOverrides).work_records.parttime).toBe("none");
    // 그 줄을 다른 값으로 바꾸는 것은 막는다(저장돼 있던 그대로만 둘 수 있다).
    const again = openWindow();
    expect((await again.save({ ...asForm(again.draft), userOverrides: [{ userId: STAFF_A, menu: "work_records", access: "full" }] }))?.error).toBe("이 역할에서 잠긴 메뉴 권한은 변경할 수 없습니다");
  });
});
