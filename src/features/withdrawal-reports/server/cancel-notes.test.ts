import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 요청 취소 기록(원장 2026-11-06 — 목록 상태 칸의 취소 사유 말풍선 데이터) — 처리 이력 'cancel' 줄을 목록의 보고서 id로 한 번에(묶음 · 쪽) 읽고
 * 학원으로 거른다 · 보고서마다 마지막 줄 · 공백 사유는 null(옛 취소와 같게).
 */
const m = vi.hoisted(() => ({ rows: [] as unknown[], calls: [] as unknown[][] }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      for (const k of ["select", "eq", "in", "order"]) q[k] = (...a: unknown[]) => { m.calls.push([table, k, ...a]); return q; };
      q.range = async (from: number) => { m.calls.push([table, "range", from]); return { data: from === 0 ? m.rows : [], error: null }; };
      return q;
    },
  }),
}));
import { loadCancelNotes } from "./cancel-notes";

beforeEach(() => { m.rows = []; m.calls = []; });

describe("loadCancelNotes", () => {
  it("학원 · 'cancel' 줄 · 목록 보고서 id로 · 시각+id 순 쪽 조회", async () => {
    await loadCancelNotes("t1", ["r1", "r2", "r1"]);
    expect(m.calls).toEqual(expect.arrayContaining([
      ["withdrawal_report_events", "eq", "tenant_id", "t1"], ["withdrawal_report_events", "eq", "action", "cancel"],
      ["withdrawal_report_events", "in", "report_id", ["r1", "r2"]], ["withdrawal_report_events", "order", "created_at"], ["withdrawal_report_events", "order", "id"],
      ["withdrawal_report_events", "range", 0],
    ]));
    expect(await loadCancelNotes("t1", [])).toEqual(new Map());
  });
  it("보고서마다 마지막 줄 · 사유 앞뒤 공백 정리 · 빈 사유는 null(옛 취소)", async () => {
    m.rows = [
      { report_id: "r1", actor_id: "a", comment: null, created_at: "2026-11-01T00:00:00Z" },
      { report_id: "r1", actor_id: "b", comment: "  다시 다님 ", created_at: "2026-11-06T00:00:00Z" },
      { report_id: "r2", actor_id: null, comment: "   ", created_at: "2026-11-02T00:00:00Z" },
    ];
    const out = await loadCancelNotes("t1", ["r1", "r2"]);
    expect(out.get("r1")).toEqual({ reason: "다시 다님", actorId: "b", at: "2026-11-06T00:00:00Z" });
    expect(out.get("r2")).toEqual({ reason: null, actorId: null, at: "2026-11-02T00:00:00Z" });
  });
});
