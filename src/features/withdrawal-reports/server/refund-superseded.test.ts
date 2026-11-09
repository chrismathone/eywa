import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 원장 결정(2026-11-06 · C.3) — 앱 미리 판정 `loadRefundLink().superseded`: 취소된 요청에만 이어진 옛 요청서인데 같은 청구 줄을 담은
 * 새 퇴원 요청의 요청서(취소되지 않은 묶음 · 문서가 남음)가 있으면 true → 수납 화면 완료일자 잠금 · 저장 액션 거절(DB 트리거와 같은 판정).
 */
const T = "t1";
const DOC = "60000000-0000-4000-8000-000000000001";
const NEW = "60000000-0000-4000-8000-000000000002";
const INV = "40000000-0000-4000-8000-000000000001";
const m = vi.hoisted(() => ({ reportStatus: "canceled", mine: [] as { line_key: string }[], others: [] as { line_key: string; document_id: string; group_id: string }[],
  named: [] as { line_key: string; document_id: string; group_id: string }[], cap: [] as { paid_net: number | null }[],
  groups: [] as { id: string; status: string }[], docs: [] as { id: string }[] }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const ops: unknown[][] = [];
      const q: Record<string, unknown> = {};
      for (const k of ["select", "eq", "neq", "in", "or", "order", "contains"]) q[k] = (...a: unknown[]) => { ops.push([k, ...a]); return q; };
      const data = () => {
        if (table === "withdrawal_report_refunds") return { desk_id: "desk", report_id: "r-old" };
        if (table === "withdrawal_reports") return { status: m.reportStatus };
        if (table === "users") return { display_name: "데스크", status: "active" };
        if (table === "withdrawal_report_refund_decisions") {
          if (ops.some((o) => o[0] === "select" && o[1] === "paid_net")) return m.cap;               // 상한(리뷰 r2 I6)
          if (ops.some((o) => o[0] === "contains")) return m.named;                                 // 이 요청서를 대체한다고 적은 새 결정(리뷰 r2 D-1 ⅰ)
          return ops.some((o) => o[0] === "neq") ? m.others : m.mine;
        }
        if (table === "withdrawal_report_groups") return m.groups;
        if (table === "academy_documents") return m.docs;
        return null;
      };
      q.maybeSingle = async () => ({ data: data(), error: null });
      q.limit = async () => ({ data: data(), error: null });
      q.then = (a: (v: unknown) => unknown) => Promise.resolve({ data: data(), error: null }).then(a);
      return q;
    },
  }),
}));
import { loadRefundLink } from "./refund-steps";

beforeEach(() => {
  m.reportStatus = "canceled";
  m.mine = [{ line_key: `${INV}#a0-1` }];
  m.others = [{ line_key: `${INV}#a0-2`, document_id: NEW, group_id: "g-new" }];
  m.groups = [{ id: "g-new", status: "pending" }];
  m.docs = [{ id: NEW }];
  m.named = [];
  m.cap = [{ paid_net: 315000 }];
});

describe("C.3 — 같은 청구 줄에 새 요청서가 있는 옛 요청서", () => {
  it("🔴 취소된 요청의 옛 요청서 + 새 요청(진행 중)의 요청서가 형제 줄(차례 번호만 다름)을 담음 → superseded", async () => {
    expect(await loadRefundLink(T, DOC)).toEqual({ deskId: "desk", deskName: "데스크", deskActive: true, superseded: true, supersededBy: { documentId: NEW, deskName: "데스크" }, cap: 315000, capLines: 1, canceledOnly: true });
  });
  it("청구 전체('all')도 겹친 것으로 본다", async () => {
    m.others = [{ line_key: `${INV}#all`, document_id: NEW, group_id: "g-new" }];
    expect((await loadRefundLink(T, DOC))?.superseded).toBe(true);
  });
  it("옛 요청서의 요청이 취소되지 않았거나 · 새 요청이 취소됐거나 · 새 요청서가 지워졌거나 · 줄이 안 겹치면 false", async () => {
    m.reportStatus = "approved";
    expect((await loadRefundLink(T, DOC))?.superseded).toBe(false);
    m.reportStatus = "canceled"; m.groups = [{ id: "g-new", status: "canceled" }];
    expect((await loadRefundLink(T, DOC))?.superseded).toBe(false);
    m.groups = [{ id: "g-new", status: "pending" }]; m.docs = [];
    expect((await loadRefundLink(T, DOC))?.superseded).toBe(false);
    m.docs = [{ id: NEW }]; m.others = [{ line_key: `${INV}#b9`, document_id: NEW, group_id: "g-new" }];
    expect((await loadRefundLink(T, DOC))?.superseded).toBe(false);
  });
  it("🔴 미배분 ↔ 줄(겹침 규칙) · 키가 안 겹쳐도 새 결정이 이 요청서를 대체한다고 적었으면(수납명 변경) superseded(리뷰 r2 D-1)", async () => {
    m.mine = [{ line_key: `${INV}#unalloc` }];
    m.others = [{ line_key: `${INV}#k1`, document_id: NEW, group_id: "g-new" }];
    expect((await loadRefundLink(T, DOC))?.superseded).toBe(true);
    m.mine = [{ line_key: `${INV}#a` }];
    m.others = [{ line_key: `${INV}#b`, document_id: NEW, group_id: "g-new" }];
    expect((await loadRefundLink(T, DOC))?.superseded).toBe(false);
    m.named = [{ line_key: `${INV}#b`, document_id: NEW, group_id: "g-new" }];
    expect((await loadRefundLink(T, DOC))?.supersededBy).toEqual({ documentId: NEW, deskName: "데스크" });
  });
  it("상한 = 이 요청서 '환불' 결정 paid_net 합 · 하나라도 비면(옛 연결) 모름(null)", async () => {
    m.reportStatus = "approved";
    m.cap = [{ paid_net: 200000 }, { paid_net: 0 }, { paid_net: 115000 }];
    expect(await loadRefundLink(T, DOC)).toMatchObject({ cap: 315000, capLines: 2, superseded: false, supersededBy: null });
    m.cap = [{ paid_net: 200000 }, { paid_net: null }];
    expect((await loadRefundLink(T, DOC))?.cap).toBeNull();
    m.cap = [];
    expect((await loadRefundLink(T, DOC))?.cap).toBeNull();
  });
});
