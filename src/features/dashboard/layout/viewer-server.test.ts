import { beforeEach, expect, it, vi } from "vitest";

/**
 * 운영실 묶음·담당 과목 — '다른 강사 뷰'면 **대상 직원** 기준(호출부가 로그인 계정을 넘겨도). 메뉴 권한은 대상 값인데 배치만 로그인
 * 계정이면 대상 직원 화면에 원장 묶음(모든 카드)이 선다(원장 2026-11-05 강사뷰 전수).
 */
const m = vi.hoisted(() => ({ viewAs: vi.fn(), superAdmin: vi.fn(), subjectsOf: vi.fn(), settings: vi.fn() }));
vi.mock("@/lib/auth/view-as", () => ({ viewAsTeacher: m.viewAs }));
vi.mock("@/lib/auth/super-admin", () => ({ isCurrentUserSuperAdmin: m.superAdmin }));
vi.mock("@/lib/observability/report-error", () => ({ reportError: vi.fn() }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: m.settings }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      let id = "";
      const q = {
        select: () => q,
        eq: (_k: string, v: string) => { id = v; return q; },
        maybeSingle: async () => ({ data: { subjects: m.subjectsOf(id) }, error: null }),
      };
      return q;
    },
  }),
}));
import { loadViewerBundle } from "./viewer-server";

const master = { id: "11111111-1111-1111-1111-111111111111", tenantId: "t1", systemRole: "master", displayName: "원장", email: "", jobTitle: null } as const;
const subjectAdmin = { id: "22222222-2222-2222-2222-222222222222", tenantId: "t1", systemRole: "admin", displayName: "영어 실장", email: "", jobTitle: null } as const;

beforeEach(() => {
  vi.clearAllMocks();
  m.superAdmin.mockResolvedValue(false);
  m.settings.mockResolvedValue({ dashboard: { assignments: [] } });
  m.subjectsOf.mockImplementation((id: string) => (id === subjectAdmin.id ? ["english"] : []));
});

it("강사뷰면 로그인 계정(원장)을 넘겨도 대상 직원(과목 관리자)의 묶음·담당 과목으로 판정한다", async () => {
  m.viewAs.mockResolvedValue({ ...subjectAdmin, access: "full" });
  const out = await loadViewerBundle(master);
  expect(out).toEqual({ bundle: "subject", subjects: ["english"], subjectScoped: true });
  expect(m.subjectsOf).toHaveBeenCalledWith(subjectAdmin.id);
});

it("강사뷰가 아니면 넘긴 사람 그대로 — 원장은 원장 묶음", async () => {
  m.viewAs.mockResolvedValue(null);
  expect(await loadViewerBundle(master)).toMatchObject({ bundle: "owner", subjectScoped: false });
  expect(m.subjectsOf).not.toHaveBeenCalled(); // 관리자(admin)만 담당 과목을 읽는다
});
