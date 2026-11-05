// 수납 자유 배분 — '관리자 이상' 판정은 역할을 본다. '다른 강사 뷰'면 대상 직원 X의 역할로(원장 2026-11-05 강사뷰 전수).
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ user: vi.fn(), terms: vi.fn() }));

vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canWriteTenant: async () => true }));
vi.mock("@/lib/auth/super-admin", () => ({ isCurrentUserSuperAdmin: async () => false }));
vi.mock("@/features/audit/server/log", () => ({ logAction: vi.fn() }));
vi.mock("./module-gate", () => ({ SESSION_BILLING_OFF: "꺼짐", sessionBillingOff: async () => false }));
vi.mock("./queries", () => ({ getSessionTermsView: m.terms }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      const q: Record<string, unknown> = {};
      for (const k of ["select", "eq", "neq"]) q[k] = () => q;
      q.maybeSingle = async () => ({ data: { period: "2026-11", student_id: "s1", line_items: [] }, error: null });
      return q;
    },
  }),
}));

import { getReceiptAllocation, saveFreeReceiptAllocation } from "./receipt-allocation-actions";

const A = { id: "a1", tenantId: "t1", systemRole: "master" };
const X = { id: "x1", tenantId: "t1", systemRole: "accountant" };

beforeEach(() => {
  vi.clearAllMocks();
  m.user.mockImplementation(async (o?: { teacherView?: boolean }) => (o?.teacherView ? X : A));
  m.terms.mockResolvedValue({ rows: [], enrollmentHistory: [] });
});

describe("수납 자유 배분 — 강사뷰 역할", () => {
  it("🔴 대상 X(회계) 화면에서는 원장 A의 '관리자 이상'이 열리지 않는다 — 저장 거절", async () => {
    expect(await saveFreeReceiptAllocation("inv", [], [{ termId: "t", amount: 1, confirmedAt: null, baseAmount: null }]))
      .toEqual({ error: "자유 배분은 관리자 이상만 할 수 있습니다" });
  });

  it("🔴 화면 전환 근거(canFree)도 X의 역할", async () => {
    const r = await getReceiptAllocation("inv");
    expect(r.data?.canFree).toBe(false);
  });

  it("강사뷰가 아니면 실제 계정의 역할 그대로(원장 = 관리자 이상)", async () => {
    m.user.mockResolvedValue(A);
    expect((await getReceiptAllocation("inv")).data?.canFree).toBe(true);
  });
});
