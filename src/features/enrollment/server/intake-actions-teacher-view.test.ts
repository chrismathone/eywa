// 신규 콜 공개 접수 링크 — '다른 강사 뷰'면 만든 사람(created_by)이 대상 직원 X, 열람 전용 강사뷰는 맨 앞에서 거절(적대 리뷰 2026-11-05).
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  user: vi.fn(), level: vi.fn(), readonly: vi.fn(), log: vi.fn(),
  inserts: [] as Record<string, unknown>[],
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/auth/perm-matrix", () => ({ accessLevelTenant: m.level }));
vi.mock("@/lib/auth/view-as", () => ({ readonlyTeacherViewError: m.readonly }));
vi.mock("@/features/audit/server/log", () => ({ logAction: m.log, logActionAs: vi.fn() }));
vi.mock("@/features/enrollment/server/prep-generate", () => ({ generatePrepBriefOnIntake: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        m.inserts.push(row);
        return { error: null };
      },
    }),
  }),
}));

import { createIntakeToken } from "./intake-actions";

const A = { id: "a1", tenantId: "t1", systemRole: "master", displayName: "원장" };
const X = { id: "x1", tenantId: "t1", systemRole: "counselor", displayName: "상담실장" };

beforeEach(() => {
  vi.clearAllMocks();
  m.inserts = [];
  m.user.mockImplementation(async (o?: { teacherView?: boolean }) => (o?.teacherView ? X : A));
  m.level.mockResolvedValue("full");
  m.readonly.mockResolvedValue(null);
});

describe("공개 접수 링크 — 강사뷰 신원", () => {
  it("🔴 만든 사람(created_by)은 대상 X · 권한 판정도 X의 역할로", async () => {
    const fd = new FormData();
    fd.set("name", "오픈하우스");
    expect(await createIntakeToken(undefined, fd)).toEqual({ ok: true });
    expect(m.inserts[0]).toMatchObject({ tenant_id: "t1", name: "오픈하우스", created_by: "x1" });
    expect(m.level).toHaveBeenCalledWith("counselor", "enrollment");
  });

  it("🔴 열람 전용 강사뷰는 맨 앞에서 거절한다", async () => {
    m.readonly.mockResolvedValue("다른 강사 화면은 열람 전용입니다");
    expect(await createIntakeToken(undefined, new FormData())).toEqual({ error: "다른 강사 화면은 열람 전용입니다" });
    expect(m.inserts).toEqual([]);
    expect(m.user).not.toHaveBeenCalled();
  });
});
