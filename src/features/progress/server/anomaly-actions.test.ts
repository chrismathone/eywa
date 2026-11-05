/**
 * 진도 이상 '이상 없음 확인'은 담당 학생 판정·확인자(resolved_by)를 **화면 주인**으로 한다(2026-11-05 강사뷰 신원 점검).
 * 관리자 A가 '다른 강사 뷰'로 강사 X를 열면 수준은 X 것(scoped)인데 담당 판정을 A의 id로 해서 X의 학생인데도 "권한이 없습니다"였다.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const A = { id: "a-admin", tenantId: "t1", email: "", displayName: "원장", jobTitle: null, systemRole: "admin" as const };
const X = { id: "x-teacher", tenantId: "t1", email: "", displayName: "강사X", jobTitle: null, systemRole: "teacher" as const };

const m = vi.hoisted(() => ({ user: vi.fn(), level: vi.fn(), owns: vi.fn(), updates: [] as Record<string, unknown>[] }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/auth/perm-matrix", () => ({ accessLevelTenant: m.level }));
vi.mock("@/features/onescreen/server/scope", () => ({ teacherOwnsStudent: m.owns }));
vi.mock("@/features/audit/server/log", () => ({ logAction: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.maybeSingle = async () => ({ data: { id: "ev1", student_id: "s1", event_type: "jump_error" }, error: null });
      q.update = (row: Record<string, unknown>) => { m.updates.push(row); return { eq: async () => ({ error: null }) }; };
      return q;
    },
  }),
}));

import { setProgressAnomalyResolved } from "./anomaly-actions";

beforeEach(() => {
  vi.clearAllMocks();
  m.updates = [];
  m.user.mockImplementation(async (o?: { teacherView?: boolean }) => (o?.teacherView ? X : A));
  m.level.mockResolvedValue("scoped");
  m.owns.mockImplementation(async (_db: unknown, teacherId: string) => teacherId === X.id);
});

describe("진도 이상 확인 — 강사뷰", () => {
  it("대상 강사 X의 담당 학생이면 확인하고, 확인자도 X다", async () => {
    expect(await setProgressAnomalyResolved("ev1", true)).toEqual({ ok: true });
    expect(m.user).toHaveBeenCalledWith({ teacherView: true });
    expect(m.owns).toHaveBeenCalledWith(expect.anything(), X.id, "s1");
    expect(m.updates[0]).toMatchObject({ resolved_by: X.id });
  });

  it("X의 학생이 아니면(실제 계정 A의 학생이어도) 거절한다", async () => {
    m.owns.mockImplementation(async (_db: unknown, teacherId: string) => teacherId === A.id);
    expect(await setProgressAnomalyResolved("ev1", true)).toEqual({ ok: false, error: "권한이 없습니다" });
    expect(m.updates).toHaveLength(0);
  });

  it("읽기 강사뷰(수준 readonly)는 확인하지 못한다", async () => {
    m.level.mockResolvedValue("readonly");
    expect(await setProgressAnomalyResolved("ev1", true)).toEqual({ ok: false, error: "권한이 없습니다" });
  });
});
