import { beforeEach, describe, expect, it, vi } from "vitest";
import { markFolded } from "@/lib/folded-read";

/**
 * 데스크 담당자로 고를 수 있는 사람(원장 2026-11-06) = 학원 설정 '데스크 담당자'로 지정한 사람 중 수납 쓰기 권한이 있는 재직 직원.
 * 지정이 비었거나 학원 설정을 못 읽었으면 아무도 없다(`designated: false` — 환불 승인을 막는다 · 원장 등으로 대신하지 않는다).
 */
const m = vi.hoisted(() => ({ settings: null as unknown, users: [] as unknown[], queried: [] as unknown[][] }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: async () => m.settings }));
vi.mock("@/features/owner/server/platform-settings", () => ({ platformAccountIds: async () => new Set<string>() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const q: Record<string, unknown> = {};
      for (const k of ["select", "eq", "neq", "in", "order"]) q[k] = (...a: unknown[]) => { m.queried.push([k, ...a]); return q; };
      q.limit = async () => ({ data: m.users, error: null });
      return q;
    },
  }),
}));
import { loadDeskStaff } from "./refund";

const settings = (deskIds?: string[]) => ({ permissions: { overrides: [], userOverrides: [], specialAccess: { payslipViewerIds: [], leaveAdjusterIds: [], classSplitterIds: [], staffSubjectScopes: [], ...(deskIds ? { withdrawalDeskIds: deskIds } : {}) } }, modules: { disabled: [] } });

beforeEach(() => { m.queried = []; m.users = [{ id: "acc", display_name: "회계", system_role: "accountant" }, { id: "mgr", display_name: "매니저", system_role: "manager" }]; });

describe("loadDeskStaff — 학원 설정 데스크 명단 ∩ 수납 쓰기 권한", () => {
  it("🔴 명단이 없으면(칸 없음 · 빈 명단) 아무도 없고 직원을 읽지도 않는다", async () => {
    for (const s of [settings(), settings([])]) {
      m.settings = s;
      expect(await loadDeskStaff("t1")).toEqual({ staff: [], designated: false, folded: false });
    }
    expect(m.queried).toEqual([]);
  });
  it("🔴 학원 설정을 못 읽어 기본값으로 접혔으면 아무도 없다(지정 밖으로 풀리지 않는다)", async () => {
    m.settings = markFolded(settings(["acc"]), "read failed");
    // 접힘은 따로 알린다 — 화면이 '데스크 담당자를 지정하세요'로 헛걸음시키지 않고 '학원 설정을 불러오지 못했습니다'(리뷰 r2 m7).
    expect(await loadDeskStaff("t1")).toEqual({ staff: [], designated: false, folded: true });
  });
  it("명단의 사람만 읽고 · 그중 수납 쓰기 권한자만(기본 권한표에서 매니저는 수납 읽기만)", async () => {
    m.settings = settings(["acc", "mgr"]);
    expect(await loadDeskStaff("t1")).toEqual({ staff: [{ id: "acc", name: "회계", jobTitle: null }], designated: true, folded: false });
    // 직급이 있으면 함께(고르기 목록 '회계 주임' — 리뷰 r2 m15)
    m.users = [{ id: "acc", display_name: "회계", system_role: "accountant", job_title: " 주임 " }];
    expect((await loadDeskStaff("t1")).staff).toEqual([{ id: "acc", name: "회계", jobTitle: "주임" }]);
    expect(m.queried).toContainEqual(["in", "id", ["acc", "mgr"]]);
  });
  it("명단은 있는데 고를 사람이 없으면 designated: true · staff: [] (화면이 '다시 지정' 안내)", async () => {
    m.settings = settings(["mgr"]);
    m.users = [{ id: "mgr", display_name: "매니저", system_role: "manager" }];
    expect(await loadDeskStaff("t1")).toEqual({ staff: [], designated: true, folded: false });
  });
});
