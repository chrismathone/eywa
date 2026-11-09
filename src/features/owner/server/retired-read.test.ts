import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 읽을 때 거르기(원장 2026-11-09) — 이미 남아 있는 퇴사자(엄소윤처럼 정리 전에 퇴사한 사람)도 배포 즉시 권한을 잃는다.
 * 설정 읽기 둘(로그인 사용자 `getTenantSettings` · 서버 키 `getTenantSettingsByTenantId`)이 같은 규칙으로 거르는지 본다 —
 * 급여명세서 열람·관리 · 연차 조정 · 수업 나누기 · 업무 처리 현황 · 데스크 담당 등의 게이트·후보 목록이 전부 이 값을 읽는다.
 */
const RETIRED = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACTIVE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PENDING = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const DELETED = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const OTHER_BRANCH = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"; // 다른 지점 계정(운영 계정 등) — 있으면 그대로

const m = vi.hoisted(() => ({
  usersError: null as null | { message: string },
  usersCalls: 0,
}));
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn, updateTag: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => ({ id: ACTIVE, tenantId: "t-1", systemRole: "master" }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("./platform-settings", () => ({ platformAccountIds: vi.fn() }));
const STORED = {
  permissions: {
    userOverrides: [{ userId: RETIRED, menu: "approvals", access: "full" }],
    specialAccess: {
      payslipViewerIds: [RETIRED, ACTIVE],
      payslipManagerIds: [RETIRED],
      leaveAdjusterIds: [RETIRED, PENDING],
      classSplitterIds: [DELETED, OTHER_BRANCH],
      staffTaskMonitorIds: [RETIRED],
      withdrawalDeskIds: [RETIRED, ACTIVE],
      withdrawalApproverIds: [RETIRED],
      studentStatusManagerIds: [RETIRED, ACTIVE],
      staffSubjectScopes: [{ userId: RETIRED, subjects: ["math"] }, { userId: ACTIVE, subjects: ["english"] }],
    },
  },
};
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const q = {
        select: () => q,
        eq: () => q,
        in: async (_col: string, ids: string[]) => {
          m.usersCalls++;
          if (m.usersError) return { data: null, error: m.usersError };
          const rows = [
            { id: RETIRED, status: "inactive" },
            { id: ACTIVE, status: "active" },
            { id: PENDING, status: "pending" },
            { id: OTHER_BRANCH, status: "active" },
          ];
          return { data: rows.filter((r) => ids.includes(r.id)), error: null };
        },
        maybeSingle: async () => (table === "tenant_settings" ? { data: { data: STORED }, error: null } : { data: { name: "합성 학원" }, error: null }),
      };
      return q;
    },
  }),
}));

const { getTenantSettings, getTenantSettingsByTenantId } = await import("./queries");

beforeEach(() => {
  m.usersError = null;
  m.usersCalls = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe.each([
  ["로그인 사용자의 설정 읽기(getTenantSettings)", () => getTenantSettings()],
  ["서버 키 설정 읽기(getTenantSettingsByTenantId — 정기 처리)", () => getTenantSettingsByTenantId("t-1")],
])("%s", (_name, load) => {
  it("🔴 퇴사자·지워진 계정은 개인별 기능 권한에서 빠지고, 재직·대기·다른 지점 계정은 그대로", async () => {
    const sa = (await load()).permissions.specialAccess;
    expect(sa.payslipViewerIds).toEqual([ACTIVE]);
    expect(sa.payslipManagerIds).toEqual([]);
    expect(sa.leaveAdjusterIds).toEqual([PENDING]);
    expect(sa.classSplitterIds).toEqual([OTHER_BRANCH]);
    expect(sa.staffTaskMonitorIds).toEqual([]);
    expect(sa.withdrawalDeskIds).toEqual([ACTIVE]);
    expect(sa.studentStatusManagerIds).toEqual([ACTIVE]);
    expect(sa.staffSubjectScopes.map((r) => r.userId)).toEqual([ACTIVE]);
    // 퇴원보고서 승인자가 모두 퇴사자면 그대로 둔다(비우면 '지정 없음 = 과목 관리자 전원'으로 넓어진다).
    expect(sa.withdrawalApproverIds).toEqual([RETIRED]);
  });

  it("퇴사자 조회가 실패하면 거르지 않는다(종전과 같다 — 퇴사자는 로그인이 막혀 본인 판정은 그대로 닫힌다)", async () => {
    m.usersError = { message: "synthetic" };
    const sa = (await load()).permissions.specialAccess;
    expect(sa.payslipViewerIds).toEqual([RETIRED, ACTIVE]);
  });
});
