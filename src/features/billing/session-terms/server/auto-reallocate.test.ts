import { beforeEach, describe, expect, it, vi } from "vitest";

// 배분 자동 재확정 서버 래퍼 — 어떤 실패도 확정 응답으로 새지 않는다 · 저장은 같은 DB 함수 · 감사로그는 저장된 것만.
const h = vi.hoisted(() => ({
  after: [] as (() => unknown)[],
  log: vi.fn(),
  rpc: vi.fn(),
  rows: { own: [] as unknown[], siblings: [] as unknown[] },
  fail: null as null | "own" | "siblings",
}));
vi.mock("next/server", () => ({ after: (f: () => unknown) => h.after.push(f) }));
vi.mock("@/features/audit/server/log", () => ({ logAction: h.log }));
vi.mock("@/lib/supabase/db-error", () => ({ logDbError: vi.fn() }));

import { autoReallocateAfterConfirm } from "./auto-reallocate";

const T1 = "11111111-1111-4111-8111-111111111111";
const INV = "22222222-2222-4222-8222-222222222222";
const math = { kind: "수업", description: "중2 수학 A반", amount: 240000 };
const invoice = { id: INV, line_items: [math], status: "paid" };

/** PostgREST 빌더 흉내 — select 문자열로 어느 조회인지 가른다. */
function db() {
  return {
    from: () => {
      let cols = "";
      const q = {
        select: (c: string) => { cols = c; return q; },
        in: () => q, order: () => q, range: () => q,
        then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
          const which = cols === "invoice_id" ? "own" : "siblings";
          const res = h.fail === which ? { data: null, error: { message: "boom" } } : { data: h.rows[which], error: null };
          return Promise.resolve(res).then(ok, bad);
        },
      };
      return q;
    },
    rpc: h.rpc,
  } as never;
}

beforeEach(() => {
  h.after.length = 0; h.log.mockReset(); h.rpc.mockReset(); h.fail = null;
  h.rows.own = [{ invoice_id: INV }];
  // 혼자 받는 항목의 반을 다시 확정(기준액 240000 → 확정금액 210000) — 자동 저장 대상
  h.rows.siblings = [{
    id: T1, invoice_id: INV, class_id: "c1", amount: 210000, confirmed_sessions: 7, confirmed_at: "2026-10-01T00:00:00+00:00", pricing_mode: "per_session",
    allocation_line_index: 0, allocation_amount: 240000, allocation_source: math, allocation_base_amount: 240000,
    class: { class_name: "중2 수학 A반" }, invoice,
  }];
});

describe("autoReallocateAfterConfirm", () => {
  it("저장은 사람이 누르는 것과 같은 DB 함수로, 감사로그는 저장된 청구서만", async () => {
    h.rpc.mockResolvedValue({ error: null });
    expect(await autoReallocateAfterConfirm(db(), [T1], "confirm")).toEqual({ saved: 1, skipped: 0 });
    expect(h.rpc).toHaveBeenCalledWith("save_session_receipt_allocations", {
      p_invoice_id: INV, p_expected_lines: [math],
      p_rows: [{ termId: T1, lineIndex: 0, amount: 240000, baseAmount: 210000, confirmedAt: "2026-10-01T00:00:00+00:00" }],
    });
    await Promise.all(h.after.map((f) => f()));
    expect(h.log).toHaveBeenCalledWith(expect.objectContaining({ action: "session_term_receipt_allocate_auto", metadata: expect.objectContaining({ invoiceId: INV, trigger: "confirm" }) }));
  });

  it("DB 함수가 거절하면(그 사이 바뀜) 저장 0 · 감사로그 없음 · throw 없음", async () => {
    h.rpc.mockResolvedValue({ error: { message: "반 확정값이 변경되었습니다" } });
    expect(await autoReallocateAfterConfirm(db(), [T1], "confirm")).toEqual({ saved: 0, skipped: 1 });
    expect(h.after).toHaveLength(0);
  });

  it("RPC 자체가 터져도(네트워크) 확정 응답으로 새지 않는다", async () => {
    h.rpc.mockRejectedValue(new Error("network"));
    await expect(autoReallocateAfterConfirm(db(), [T1], "confirm")).resolves.toEqual({ saved: 0, skipped: 1 });
  });

  it("조회가 실패해도 throw 없이 아무것도 안 한다", async () => {
    for (const which of ["own", "siblings"] as const) {
      h.fail = which;
      await expect(autoReallocateAfterConfirm(db(), [T1], "confirm")).resolves.toEqual({ saved: 0, skipped: 0 });
    }
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("가상 줄 id(uuid 아님)·빈 목록은 조회조차 안 한다", async () => {
    expect(await autoReallocateAfterConfirm(db(), ["v:student:class", ""], "confirm")).toEqual({ saved: 0, skipped: 0 });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("배분을 저장한 적 없는 청구서는 저장하지 않는다", async () => {
    h.rows.siblings = [{ ...(h.rows.siblings[0] as object), allocation_line_index: null, allocation_amount: null, allocation_source: null, allocation_base_amount: null }];
    expect(await autoReallocateAfterConfirm(db(), [T1], "confirm")).toEqual({ saved: 0, skipped: 1 });
    expect(h.rpc).not.toHaveBeenCalled();
  });
});
