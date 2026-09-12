import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeupSessionEntries, type SessionProgress } from "../makeup-session";

const h = vi.hoisted(() => ({
  user: { id: "u1", tenantId: "t1" } as { id: string; tenantId: string } | null,
  readonly: null as string | null,
  student: { id: "s1" } as { id: string } | null,
  store: vi.fn(),
}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => h.user }));
vi.mock("@/lib/auth/view-mode", () => ({ readonlyTeacherViewError: async () => h.readonly }));
vi.mock("@/lib/date-kst", async original => ({
  ...await original<typeof import("@/lib/date-kst")>(),
  resolveReportDate: (date: string) => date > "2026-09-12" ? "2026-09-12" : date,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: () => {
  const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: h.student, error: null }) };
  return q;
} }) }));
vi.mock("@/features/classes/server/delegation", () => ({ getTeachingClasses: async () => [{ id: "c1", subject: "math", className: "내 수학반" }] }));
vi.mock("./makeup-session-store", () => ({ changeMakeupSession: h.store }));
const { registerMakeupEntries } = await import("./makeup-register-actions");

beforeEach(() => {
  h.user = { id: "u1", tenantId: "t1" }; h.readonly = null; h.student = { id: "s1" };
  h.store.mockReset().mockResolvedValue({ ok: true, updatedAt: "2026-09-12T06:00:00Z" });
});
const input = { studentId: "s1", date: "2026-09-12", entries: [{ subject: "math", absentDate: "2026-09-13", units: 1 }] };
describe("보강 추가 저장 게이트", () => {
  it("내일 결석분을 오늘 본인 명단에 저장한다", async () => {
    expect((await registerMakeupEntries(input)).ok).toBe(true);
    expect(h.store.mock.calls[0][1]).toEqual({ tenantId: "t1", teacherId: "u1", studentId: "s1", date: "2026-09-12" });
    const merge = h.store.mock.calls[0][2] as (p: SessionProgress) => SessionProgress;
    expect(makeupSessionEntries(merge({}))[0].absentDate).toBe("2026-09-13");
  });
  it("저장 실패를 성공으로 돌리지 않는다", async () => {
    h.store.mockResolvedValue({ ok: false, error: "저장 실패" });
    expect(await registerMakeupEntries(input)).toEqual({ ok: false, error: "저장 실패" });
  });
  it("다른 강사 열람 중에는 저장하지 않는다", async () => {
    h.readonly = "열람 전용";
    expect((await registerMakeupEntries(input)).ok).toBe(false);
    expect(h.store).not.toHaveBeenCalled();
  });
  it("타 학원 학생과 담당하지 않는 과목·반은 저장하지 않는다", async () => {
    for (const entries of [[{ subject: "english" }], [{ subject: "math", makeupClassId: "other" }]]) {
      expect((await registerMakeupEntries({ ...input, entries })).ok).toBe(false);
    }
    h.student = null;
    expect((await registerMakeupEntries(input)).ok).toBe(false);
    expect(h.store).not.toHaveBeenCalled();
  });
  it("조회 날짜를 미래에서 오늘로 몰래 바꿔 저장하지 않는다", async () => {
    expect((await registerMakeupEntries({ ...input, date: "2026-09-13" })).ok).toBe(false);
    expect(h.store).not.toHaveBeenCalled();
  });
});
