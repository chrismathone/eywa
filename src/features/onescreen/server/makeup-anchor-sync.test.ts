import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 원반 담임이 아닌 **맡은 강사**의 보강 보고서 저장 길 — 명단에 새로 서는 학생(보강관리 배정)이 실제로 저장되는지를
 * 저장 훅의 두 관문(반 수용 · 출결 칸 쓰기)에서 본다. 출결 쓰기 관문(`setAttendanceCell`)은 여기에 없다 — 넓히지 않았다.
 */
const h = vi.hoisted(() => ({
  teaching: [] as { id: string; className: string; subject: string; closedAt: string | null }[],
  enrollments: [] as { class_id: string; start_date: string | null; end_date: string | null; is_transferred: boolean; on_hold: boolean }[],
  classes: [] as { id: string; class_name: string; subject: string; closed_at: string | null }[],
  teaches: false,
  ensure: vi.fn(),
  move: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      const chain = () => q;
      Object.assign(q, {
        select: chain, eq: chain, in: chain, is: chain,
        then: (resolve: (value: { data: unknown; error: null }) => unknown) =>
          resolve({ data: table === "enrollments" ? h.enrollments : h.classes, error: null }),
      });
      return q;
    },
  }),
}));
vi.mock("@/features/classes/server/delegation", () => ({ getTeachingClasses: async () => h.teaching }));
vi.mock("@/features/attendance/server/makeup-pool", () => ({ findMakeupPoolClass: async () => null }));
vi.mock("@/features/audit/server/log", () => ({ logAction: async () => undefined }));
vi.mock("@/features/attendance/server/makeup-anchor-cells", () => ({
  applyAnchorMove: h.move,
  ensureMakeupAnchorCell: h.ensure,
  ownerTeachesClassOn: async () => h.teaches,
  planAnchorMove: async () => ({ kind: "none" }),
}));

const { prepareMakeupAnchor, syncAnchorCells } = await import("./makeup-anchor-sync");
type Client = Parameters<typeof prepareMakeupAnchor>[0];
const supabase = {} as Client;
const DATE = "2026-10-05";
const prepare = (wanted: string | null, subject = "math") => prepareMakeupAnchor(supabase, {
  tenantId: "t1", candidatesFor: "teacher-t", studentId: "s1", date: DATE, subject, wanted, prior: null, anchorRequired: async () => true,
});

beforeEach(() => {
  h.teaching = [];
  h.enrollments = [{ class_id: "class-b", start_date: "2026-01-01", end_date: null, is_transferred: false, on_hold: false }];
  h.classes = [{ id: "class-b", class_name: "학생의 원래 반", subject: "math", closed_at: null }];
  h.teaches = false;
  h.ensure.mockReset().mockResolvedValue({ ok: true, created: true });
  h.move.mockReset();
});

describe("맡은 강사의 보강 보고서 — 반 수용", () => {
  it("담당 반이 하나도 없는 강사도 학생이 다니는 반(보강관리의 출결 반)으로 저장한다", async () => {
    expect(await prepare("class-b")).toEqual({ ok: true, anchor: "class-b", priorAnchor: null, move: null });
  });

  it("다른 정규반이 있는 강사도 같다 — 자기 반으로 바꿔 받지 않는다", async () => {
    h.teaching = [{ id: "class-mine", className: "내 수학반", subject: "math", closedAt: null }];
    expect(await prepare("class-b")).toMatchObject({ ok: true, anchor: "class-b" });
  });

  it("학생이 다니지 않는 반·과목이 다른 반은 받지 않는다(조용히 다른 반으로 돌리지 않는다)", async () => {
    expect((await prepare("class-c")).ok).toBe(false);
    expect((await prepare("class-b", "english")).ok).toBe(false);
  });

  it("그날 수강이 끝났거나 쉬는 반은 받지 않는다", async () => {
    h.enrollments = [{ class_id: "class-b", start_date: "2026-01-01", end_date: "2026-10-01", is_transferred: false, on_hold: false }];
    expect((await prepare("class-b")).ok).toBe(false);
    h.enrollments = [{ class_id: "class-b", start_date: "2026-01-01", end_date: null, is_transferred: false, on_hold: true }];
    expect((await prepare("class-b")).ok).toBe(false);
  });

  it("반 없이 보내면 반별 발송 대상은 저장을 막는다(반 미정 보강을 만들지 않는다)", async () => {
    expect(await prepare(null)).toMatchObject({ ok: false, needsAnchor: true });
  });
});

describe("맡은 강사의 보강 보고서 — 출결 칸", () => {
  const sync = (ownerId: string | null) => syncAnchorCells({ tenantId: "t1", studentId: "s1", date: DATE, anchor: "class-b", ownerId, move: null });

  it("그 반 담당이 아닌 강사가 저장하면 그 칸은 보강한 강사 몫으로 선다", async () => {
    expect(await sync("teacher-t")).toEqual({ ok: true, moved: 0, created: true });
    expect(h.ensure).toHaveBeenCalledWith(expect.objectContaining({ classId: "class-b", studentId: "s1", date: DATE, recordedBy: "teacher-t", taughtBy: "teacher-t" }));
  });

  it("그 반 담임이 저장하면 귀속을 따로 적지 않는다(종전 축 그대로)", async () => {
    h.teaches = true;
    await sync("teacher-h");
    expect(h.ensure).toHaveBeenCalledWith(expect.objectContaining({ classId: "class-b", taughtBy: null }));
  });

  it("칸은 섰지만 보강 기록 반영이 남았으면 그 알림을 그대로 올린다", async () => {
    h.ensure.mockResolvedValue({ ok: true, created: true, makeupEffect: { state: "pending", queued: true } });
    expect(await sync("teacher-t")).toEqual({ ok: true, moved: 0, created: true, makeupEffect: { state: "pending", queued: true } });
  });

  it("칸을 옮긴 저장도 같은 알림을 올린다 — 옮긴 칸이 곧 그 반의 칸이라 새로 세우지 않는다", async () => {
    h.move.mockResolvedValue({ ok: true, moved: 1, makeupEffect: { state: "unknown", queued: false } });
    const moved = await syncAnchorCells({ tenantId: "t1", studentId: "s1", date: DATE, anchor: "class-b", ownerId: "teacher-t",
      move: { plan: { kind: "move", ids: ["a1"] }, fromClassId: "class-a" } });
    expect(moved).toEqual({ ok: true, moved: 1, created: false, makeupEffect: { state: "unknown", queued: false } });
    expect(h.move).toHaveBeenCalledWith(expect.objectContaining({ toClassId: "class-b", taughtBy: "teacher-t" }));
    expect(h.ensure).not.toHaveBeenCalled();
  });

  it("칸을 쓰지 못하면 성공으로 돌리지 않는다", async () => {
    h.ensure.mockResolvedValue({ ok: false, error: "합성 실패" });
    expect(await sync("teacher-t")).toEqual({ ok: false, error: "합성 실패" });
  });
});
