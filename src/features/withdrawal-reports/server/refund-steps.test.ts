import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 데스크 환불 단계(s2_0025) — 2026-11-06부터 담당의 직급·재직 여부도 싣는다(승인 진행 '○ 홍길동 대리' · 퇴사면 '이전 담당자' — `deskLabel`).
 * 회계 등은 퇴원보고서 직원 목록에 없어 직접 읽는다 · 학원으로 거른다 · 못 읽으면 종전 이름만(목록·상세는 연다).
 */
const m = vi.hoisted(() => ({ users: [] as unknown[] | Error, calls: [] as unknown[][] }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      for (const k of ["select", "eq", "in", "order"]) q[k] = (...a: unknown[]) => { m.calls.push([table, k, ...a]); return q; };
      const data = table === "withdrawal_report_refunds"
        ? [{ report_id: "r1", group_id: "g1", document_id: "d1", desk_id: "dk", created_at: "1" }, { report_id: "r1", group_id: "g1", document_id: "d2", desk_id: "gone", created_at: "2" }, { report_id: "r1", group_id: "g1", document_id: "d3", desk_id: null, created_at: "3" }]
        : table === "academy_documents" ? [{ id: "d1", completed: "", desk: "홍길동" }, { id: "d2", completed: "2026-11-06", desk: "옛 데스크" }, { id: "d3", completed: null, desk: null }]
        : table === "users" ? m.users : [];
      q.then = (a: (v: unknown) => unknown, b?: (e: unknown) => unknown) => (data instanceof Error ? Promise.resolve({ data: null, error: { message: data.message } }) : Promise.resolve({ data, error: null })).then(a, b);
      return q;
    },
  }),
}));
import { loadRefundSteps } from "./refund-steps";

beforeEach(() => { m.calls = []; m.users = [{ id: "dk", display_name: "홍길동", job_title: "대리", status: "active" }, { id: "gone", display_name: "퇴사자", job_title: "주임", status: "inactive" }]; });

describe("loadRefundSteps — 데스크 담당 직급·재직", () => {
  it("직급·재직을 싣고 학원으로 거른다 · 담당이 지워졌으면(desk_id 없음) 이름만", async () => {
    const steps = (await loadRefundSteps("t1", [{ id: "r1", group_id: "g1" }])).get("g1")!;
    expect(steps).toEqual([
      { documentId: "d1", deskId: "dk", deskName: "홍길동", completedDate: null, deskTitle: "대리", deskActive: true },
      { documentId: "d2", deskId: "gone", deskName: "퇴사자", completedDate: "2026-11-06", deskTitle: "주임", deskActive: false },
      { documentId: "d3", deskId: null, deskName: "데스크", completedDate: null },
    ]);
    expect(m.calls).toContainEqual(["users", "eq", "tenant_id", "t1"]);
    expect(m.calls).toContainEqual(["users", "in", "id", ["dk", "gone"]]);
  });
  it("담당 조회가 실패해도 단계는 나온다(종전 이름만)", async () => {
    m.users = new Error("down");
    const steps = (await loadRefundSteps("t1", [{ id: "r1", group_id: "g1" }])).get("g1")!;
    expect(steps.map((s) => [s.deskName, s.deskTitle])).toEqual([["홍길동", undefined], ["옛 데스크", undefined], ["데스크", undefined]]);
  });
});
