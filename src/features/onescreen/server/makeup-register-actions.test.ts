import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeupSessionEntries, type SessionProgress } from "../makeup-session";

const h = vi.hoisted(() => ({
  user: { id: "u1", tenantId: "t1" } as { id: string; tenantId: string; displayName?: string } | null,
  readonly: null as string | null,
  student: { id: "s1" } as { id: string } | null,
  store: vi.fn(),
  classnoteOff: true, // ClassNote 모듈 꺼짐 = 반별 발송 판정 없음(옛 '수학 발송 경로' 기존 방식 자리 — 2026-11-05 걷음)
  sync: vi.fn(),
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
// 앵커 후보 = 담당 반 ∪ 학생이 다니는 반(원장 결정 2, 2026-09-30) — B는 남의 반이지만 학생이 다닌다.
vi.mock("@/lib/auth/perm-matrix", () => ({ canWriteTenant: async () => true, accessLevelTenant: async () => "full" }));
vi.mock("@/features/audit/server/log", () => ({ logAction: async () => undefined }));
vi.mock("./makeup-anchor-sync", () => ({
  syncAnchorCells: h.sync,
  loadMakeupAnchorCandidates: async () => [
    { id: "c1", className: "내 수학반", subject: "math", closedAt: null, mine: true, enrolled: false },
    { id: "B", className: "학생의 원래 반", subject: "math", closedAt: null, mine: false, enrolled: true },
  ],
}));
vi.mock("@/features/owner/server/queries", () => ({
  getTenantSettings: async () => ({ modules: { disabled: h.classnoteOff ? ["classnote"] : [] }, report: {} }),
}));
const { registerMakeupEntries } = await import("./makeup-register-actions");

beforeEach(() => {
  h.user = { id: "u1", tenantId: "t1", displayName: "강사" }; h.readonly = null; h.student = { id: "s1" }; h.classnoteOff = true;
  h.store.mockReset().mockResolvedValue({ ok: true, updatedAt: "2026-09-12T06:00:00Z" });
  h.sync.mockReset().mockResolvedValue({ ok: true, moved: 0, created: true });
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
  it("🔴 위임 없이 남의 반 학생을 대신 보강하면 학생의 원래 반(B)을 보강 반으로 받는다(원장 결정 2)", async () => {
    const res = await registerMakeupEntries({ ...input, entries: [{ subject: "math", makeupClassId: "B" }] });
    expect(res.ok).toBe(true);
    const merge = h.store.mock.calls[0][2] as (p: SessionProgress) => SessionProgress;
    expect(makeupSessionEntries(merge({}))[0].makeupClassId).toBe("B");
  });
  it("🔴 반별 발송 대상(수학 · ClassNote 켜짐)은 '반 없이' 추가할 수 없다 — 반 미정 보강을 만들지 않는다", async () => {
    h.classnoteOff = false;
    const res = await registerMakeupEntries(input);
    expect(res.ok).toBe(false);
    expect(h.store).not.toHaveBeenCalled();
    // 반을 고르면 된다
    expect((await registerMakeupEntries({ ...input, entries: [{ subject: "math", makeupClassId: "c1" }] })).ok).toBe(true);
  });
  describe("칸을 세운 뒤의 보강 기록 반영 알림", () => {
    // 세션에 새로 들어간 줄만 칸을 세운다 — 저장 함수가 넘겨받은 병합 함수를 실제로 불러야 '새 줄'이 판정된다.
    const stored = { ok: true, updatedAt: "2026-09-12T06:00:00Z", previousUpdatedAt: null };
    const withCell = { ...input, entries: [{ subject: "math", makeupClassId: "B", recordCell: true }] };
    beforeEach(() => {
      h.store.mockImplementation(async (_client: unknown, _key: unknown, merge: (p: SessionProgress) => SessionProgress) => { merge({}); return stored; });
    });
    it("대신 보강 칸은 학생의 원래 반에, 보강한 강사 이름으로 세운다", async () => {
      expect(await registerMakeupEntries(withCell)).toEqual(stored);
      expect(h.sync).toHaveBeenCalledWith(expect.objectContaining({ anchor: "B", studentId: "s1", date: "2026-09-12", ownerId: "u1", move: null }));
    });
    it("칸은 섰지만 반영이 남았으면 등록 성공과 함께 알린다(등록을 되돌리지 않는다)", async () => {
      h.sync.mockResolvedValue({ ok: true, moved: 0, created: true, makeupEffect: { state: "pending", queued: true } });
      expect(await registerMakeupEntries(withCell)).toEqual({ ...stored, makeupEffect: { state: "pending", queued: true } });
      h.sync.mockResolvedValue({ ok: true, moved: 0, created: true, makeupEffect: { state: "unknown", queued: false } });
      expect(await registerMakeupEntries(withCell)).toEqual({ ...stored, makeupEffect: { state: "unknown", queued: false } });
    });
    it("칸을 못 세운 것은 종전대로 cellError다 — 반영 알림과 섞지 않는다", async () => {
      h.sync.mockResolvedValue({ ok: false, error: "합성 실패" });
      expect(await registerMakeupEntries(withCell)).toEqual({ ...stored, cellError: "합성 실패" });
    });
  });
  it("조회 날짜를 미래에서 오늘로 몰래 바꿔 저장하지 않는다", async () => {
    expect((await registerMakeupEntries({ ...input, date: "2026-09-13" })).ok).toBe(false);
    expect(h.store).not.toHaveBeenCalled();
  });
});
