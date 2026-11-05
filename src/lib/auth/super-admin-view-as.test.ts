import { beforeEach, describe, expect, it, vi } from "vitest";

// 운영 계정(super_admin) 우회는 '다른 강사 뷰' 중에 꺼진다 — 그 강사와 같은 화면(원장 2026-11-05 강사뷰 전수 점검).
// 실제 계정 판정(isSignedInSuperAdmin)은 강사뷰 자격 · 실제 계정 권한표 · 지점 보기 감시 전용으로 그대로 남는다.
const m = vi.hoisted(() => ({
  user: { id: "u1", tenantId: "t1" } as null | { id: string; tenantId: string; tenantView?: unknown },
  superAdmin: true,
  viewAs: null as null | { id: string },
}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => m.user }));
vi.mock("@/lib/auth/view-as", () => ({ viewAsTeacher: async () => m.viewAs }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: m.superAdmin ? { id: "u1" } : null }) }) }) }),
  }),
}));

import { isCurrentUserSuperAdmin, isSignedInSuperAdmin } from "./super-admin";

beforeEach(() => {
  m.user = { id: "u1", tenantId: "t1" };
  m.superAdmin = true;
  m.viewAs = null;
});

describe("운영 계정 우회와 '다른 강사 뷰'", () => {
  it("평소 운영 계정은 둘 다 참", async () => {
    expect(await isSignedInSuperAdmin()).toBe(true);
    expect(await isCurrentUserSuperAdmin()).toBe(true);
  });
  it("강사뷰 중에는 업무 판정용(isCurrentUserSuperAdmin)만 거짓 — 실제 계정 판정은 그대로", async () => {
    m.viewAs = { id: "kim" };
    expect(await isCurrentUserSuperAdmin()).toBe(false);
    expect(await isSignedInSuperAdmin()).toBe(true);
  });
  it("운영 계정이 아니면 강사뷰와 상관없이 거짓", async () => {
    m.superAdmin = false;
    expect(await isCurrentUserSuperAdmin()).toBe(false);
    m.viewAs = { id: "kim" };
    expect(await isCurrentUserSuperAdmin()).toBe(false);
    expect(await isSignedInSuperAdmin()).toBe(false);
  });
  it("지점 보기 중에는 둘 다 거짓(그 지점 원장과 같은 화면)", async () => {
    m.user = { id: "u1", tenantId: "t1", tenantView: { tenantId: "t2" } };
    expect(await isSignedInSuperAdmin()).toBe(false);
    expect(await isCurrentUserSuperAdmin()).toBe(false);
  });
});
