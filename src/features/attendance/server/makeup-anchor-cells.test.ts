import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EffectGap } from "@/features/makeups/server/adapters/effects";

/**
 * 보강 앵커 칸을 세우거나 옮긴 뒤의 **보강 기록 반영 알림** — 출결 저장 성공과 원장 반영을 나눠 알린다.
 * 예전엔 이행 결과와 예외를 둘 다 버려 "저장됨" 하나로 보였다. 여기서는 출결 쓰기는 그대로 두고(되돌림·재전송 없음) 알림만 올리는지 본다.
 */
const h = vi.hoisted(() => ({
  existing: [] as { id: string; class_id: string; status: string; slot_start: string | null; recorded_at: string }[],
  inserted: [] as Record<string, unknown>[],
  updated: [] as Record<string, unknown>[],
  deleted: 0,
  moved: [] as { id: string }[],
  complete: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const q: Record<string, unknown> = {};
      const chain = () => q;
      Object.assign(q, {
        select: chain, eq: chain, in: chain, is: chain,
        insert: async (row: Record<string, unknown>) => { h.inserted.push(row); return { error: null }; },
        update: (row: Record<string, unknown>) => { h.updated.push(row); return q; },
        delete: () => { h.deleted += 1; return q; },
        // 조회(dayRows)와 이동(update … select)이 같은 체인을 await 한다.
        then: (resolve: (value: { data: unknown; error: null }) => unknown) =>
          resolve({ data: h.updated.length ? h.moved : h.existing, error: null }),
      });
      return q;
    },
  }),
}));
vi.mock("./taught-by-db", () => ({ taughtByColumnReady: async () => true }));
vi.mock("./makeup-reservation-complete", () => ({
  completeMakeupReservations: h.complete,
  effectGapsOf: (units: { effectGaps?: EffectGap[] }) => units.effectGaps ?? [],
}));

const { applyAnchorMove, ensureMakeupAnchorCell } = await import("./makeup-anchor-cells");

const gap = (kind: string, queued = true): EffectGap => ({ effectKey: "att:p1", kind, participantId: "p1", reservationId: "r1", error: "합성", queued });
const withGaps = (gaps: EffectGap[]) => Object.assign(new Map<string, number | null>(), { effectGaps: gaps });
const cell = { tenantId: "t1", studentId: "s1", date: "2026-10-05", classId: "class-b", recordedBy: "teacher-t", taughtBy: "teacher-t" };

beforeEach(() => {
  h.existing = []; h.inserted = []; h.updated = []; h.deleted = 0; h.moved = [];
  h.complete.mockReset().mockResolvedValue(withGaps([]));
});

describe("보강 앵커 칸 — 출결 저장과 보강 기록 반영을 나눠 알린다", () => {
  it("반영이 끝났으면 알림이 없다(평소)", async () => {
    expect(await ensureMakeupAnchorCell(cell)).toEqual({ ok: true, created: true });
    expect(h.inserted).toHaveLength(1);
  });

  it("맡은 강사가 그 반 담당이 아니면 칸의 귀속은 보강한 강사다(대신 보강)", async () => {
    await ensureMakeupAnchorCell(cell);
    expect(h.inserted[0]).toMatchObject({ class_id: "class-b", student_id: "s1", status: "makeup", recorded_by: "teacher-t", taught_by: "teacher-t" });
    h.inserted = [];
    await ensureMakeupAnchorCell({ ...cell, taughtBy: null });
    expect(h.inserted[0]).not.toHaveProperty("taught_by");
  });

  it("반영이 대기·보류로 남으면 저장 성공과 함께 알림을 올린다 — 출결은 그대로다", async () => {
    for (const kind of ["participation_pending", "participation_failed", "teacher_hold", "units_write_failed", "units_review"]) {
      h.inserted = [];
      h.complete.mockResolvedValue(withGaps([gap(kind)]));
      expect(await ensureMakeupAnchorCell(cell)).toEqual({ ok: true, created: true, makeupEffect: { state: "pending", queued: true } });
      expect(h.inserted).toHaveLength(1);
    }
    expect(h.deleted).toBe(0);
    expect(h.updated).toHaveLength(0);
  });

  it("관측(설계된 대기)은 알리지 않는다 — 단 목록에 넣지 못했으면 알린다", async () => {
    h.complete.mockResolvedValue(withGaps([gap("observation")]));
    expect(await ensureMakeupAnchorCell(cell)).toEqual({ ok: true, created: true });
    h.complete.mockResolvedValue(withGaps([gap("observation", false)]));
    expect(await ensureMakeupAnchorCell(cell)).toEqual({ ok: true, created: true, makeupEffect: { state: "pending", queued: false } });
  });

  it("이행이 예외로 끝나도 출결 저장은 성공이다 — 확인하지 못했다고 알린다(되돌리지 않는다)", async () => {
    h.complete.mockRejectedValue(new Error("합성 실패"));
    expect(await ensureMakeupAnchorCell(cell)).toEqual({ ok: true, created: true, makeupEffect: { state: "unknown", queued: false } });
    expect(h.inserted).toHaveLength(1);
    expect(h.deleted).toBe(0);
    expect(h.complete).toHaveBeenCalledTimes(1); // 다시 보내지 않는다
  });

  it("이미 선 칸은 건드리지 않고 이행도 다시 부르지 않는다", async () => {
    h.existing = [{ id: "a1", class_id: "class-b", status: "makeup", slot_start: null, recorded_at: "2026-10-05T01:00:00Z" }];
    expect(await ensureMakeupAnchorCell(cell)).toEqual({ ok: true, created: false });
    expect(h.inserted).toHaveLength(0);
    expect(h.complete).not.toHaveBeenCalled();
  });

  it("칸을 옮긴 뒤의 반영 대기도 같은 알림으로 올린다", async () => {
    h.moved = [{ id: "a1" }];
    h.complete.mockResolvedValue(withGaps([gap("participation_pending", false)]));
    const moved = await applyAnchorMove({ tenantId: "t1", ids: ["a1"], fromClassId: "class-a", toClassId: "class-b", studentId: "s1", date: "2026-10-05", taughtBy: "teacher-t" });
    expect(moved).toEqual({ ok: true, moved: 1, makeupEffect: { state: "pending", queued: false } });
    expect(h.updated[0]).toMatchObject({ class_id: "class-b", taught_by: "teacher-t" });
  });
});
