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
  // 보강 보고서 조회(지우기 게이트) — 출결 행과 따로 돌려준다.
  reports: [] as {
    student_id: string; makeup_class_id: string; report_date: string;
    classnote_status: string | null; classnote_sent_at: string | null; classnote_read_at?: string | null;
  }[],
  reportError: null as { message: string } | null,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      const chain = () => q;
      Object.assign(q, {
        select: chain, eq: chain, in: chain, is: chain,
        insert: async (row: Record<string, unknown>) => { h.inserted.push(row); return { error: null }; },
        update: (row: Record<string, unknown>) => { h.updated.push(row); return q; },
        delete: () => { h.deleted += 1; return q; },
        // 조회(dayRows)와 이동(update … select)이 같은 체인을 await 한다.
        then: (resolve: (value: { data: unknown; error: { message: string } | null }) => unknown) =>
          table === "lesson_reports"
            ? resolve({ data: h.reportError ? null : h.reports, error: h.reportError })
            : resolve({ data: h.updated.length ? h.moved : h.existing, error: null }),
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

const { ANCHOR_UNSETTLED_MESSAGE, applyAnchorMove, ensureMakeupAnchorCell, makeupAnchorDeleteBlock, makeupAnchorDeleteCheck } = await import("./makeup-anchor-cells");

const gap = (kind: string, queued = true): EffectGap => ({ effectKey: "att:p1", kind, participantId: "p1", reservationId: "r1", error: "합성", queued });
const withGaps = (gaps: EffectGap[]) => Object.assign(new Map<string, number | null>(), { effectGaps: gaps });
const cell = { tenantId: "t1", studentId: "s1", date: "2026-10-05", classId: "class-b", recordedBy: "teacher-t", taughtBy: "teacher-t" };

beforeEach(() => {
  h.existing = []; h.inserted = []; h.updated = []; h.deleted = 0; h.moved = []; h.reports = []; h.reportError = null;
  h.complete.mockReset().mockResolvedValue(withGaps([]));
});

describe("출석부 지우기 게이트 — 발송 '성공' 보강 보고서의 칸은 지운다 · 보고서는 그대로(원장 2026-11-05)", () => {
  const target = [{ studentId: "s1", classId: "class-b", date: "2026-10-05" }];
  const KEY = "s1|class-b|2026-10-05";
  const report = (status: string | null, sentAt: string | null = status === "success" ? "2026-10-05T11:00:00Z" : null, date = "2026-10-05") => ({
    student_id: "s1", makeup_class_id: "class-b", report_date: date, classnote_status: status, classnote_sent_at: sentAt,
  });
  const check = (cells = target) => makeupAnchorDeleteCheck("t1", cells, { allowSent: true });

  it("보강 보고서가 없는 칸은 그대로 지운다", async () => {
    const r = await check();
    expect(r.block).toBeNull();
    expect(r.keptSent).toBe(0);
    expect(r.keptCells.size).toBe(0);
  });

  it("🔴 발송 '성공' 보고서의 칸 — 출석부(allowSent)는 지우고 그 칸의 열쇠를 돌려준다(예약 되돌림 건너뛰기 · 감사로그)", async () => {
    h.reports = [report("success")];
    const r = await check();
    expect(r.block).toBeNull();
    expect(r.keptSent).toBe(1);
    expect([...r.keptCells]).toEqual([KEY]);
  });

  it("같은 칸을 가리키는 보고서가 둘이어도 칸은 하나로 센다 · 다른 반의 보고서는 상관없다", async () => {
    h.reports = [report("success"), report("success"), { ...report(null), makeup_class_id: "class-z" }];
    const r = await check();
    expect(r.block).toBeNull();
    expect(r.keptSent).toBe(1);
  });

  it("발송된 보고서의 칸을 ECS 보강 빼기(makeupAnchorDeleteBlock)는 막고, 시수만 빼는 길(출석부 지우기)을 알려 준다", async () => {
    h.reports = [report("success")];
    const block = await makeupAnchorDeleteBlock("t1", target);
    expect(block).toMatch(/학부모에게 발송된 보강 보고서의 반입니다 — 여기서는 뺄 수 없습니다/);
    expect(block).toMatch(/출석부에서 그 칸을 지우세요/);
  });

  it("보내기 전 보고서의 칸은 출석부에서도 막는다 — 원스크린 '보강 빼기'로 보고서와 함께(저장 때 칸이 되살아난다)", async () => {
    for (const status of [null, "too_old", "name_conflict", "blocked_shared"]) {
      h.reports = [report(status)];
      expect((await check()).block, String(status)).toMatch(/원스크린에서 '보강 빼기'/);
    }
  });

  it("🔴 발송 상태가 애매하면(대기·처리 중·실패·회수 계열 · 발송 시각만 남음) 막고 '보강 빼기'도 권하지 않는다 — 학부모가 받았을 수 있다", async () => {
    const cases: [string | null, string | null][] = [
      ["queued", null], ["processing", null], ["failed", null], ["failed", "2026-10-05T11:00:00Z"],
      ["recall_requested", "2026-10-05T11:00:00Z"], ["recalling", "2026-10-05T11:00:00Z"],
      ["recall_failed", "2026-10-05T11:00:00Z"], ["recalled", "2026-10-05T11:00:00Z"], [null, "2026-10-05T11:00:00Z"],
    ];
    for (const [status, sentAt] of cases) {
      h.reports = [report(status, sentAt)];
      const r = await check();
      expect(r.block, `${status}/${sentAt}`).toBe(ANCHOR_UNSETTLED_MESSAGE);
      expect(r.keptCells.size).toBe(0);
    }
    // 재발급으로 상태가 비었는데 학부모가 읽은 흔적이 남은 보고서 — '보강 빼기'도 발송분으로 보고 막으니 애매로(막다른 길 방지).
    h.reports = [{ ...report(null), classnote_read_at: "2026-10-05T12:00:00Z" }];
    expect((await check()).block).toBe(ANCHOR_UNSETTLED_MESSAGE);
    expect(ANCHOR_UNSETTLED_MESSAGE).toMatch(/다시 보내 성공하면 지울 수 있습니다/);
  });

  it("범위에 '성공' 아닌 칸이 하나라도 섞이면 통째로 막는다 — 애매한 상태를 먼저 말한다", async () => {
    const cells = [...target, { studentId: "s1", classId: "class-b", date: "2026-10-06" }, { studentId: "s1", classId: "class-b", date: "2026-10-07" }];
    h.reports = [report("success"), report(null, null, "2026-10-06")];
    expect((await check(cells)).block).toMatch(/원스크린에서 '보강 빼기'/);
    h.reports = [report("success"), report(null, null, "2026-10-06"), report("failed", null, "2026-10-07")];
    expect((await check(cells)).block).toBe(ANCHOR_UNSETTLED_MESSAGE);
  });

  it("반·날짜가 100개를 넘는 범위는 다 확인하지 못하니 막는다(fail-closed)", async () => {
    const cells = Array.from({ length: 101 }, (_, i) => ({ studentId: "s1", classId: `class-${i}`, date: "2026-10-05" }));
    expect((await check(cells)).block).toMatch(/범위가 너무 넓어/);
  });

  it("조회 실패는 막는다(fail-closed — 지우기는 되돌릴 수 없다)", async () => {
    h.reportError = { message: "합성 실패" };
    expect((await check()).block).toMatch(/확인하지 못해 지우지 않았습니다/);
  });
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
