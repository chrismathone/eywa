import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 원장 환불 결정(원장 2026-11-06 · s2_0033) — 처리일 cron(apply)과 release(수납 완료 입력·요청서 삭제·cron 안전망)가
 * 묶음마다 **같은 요청에서** 계산한 환불 확인 값을 넘기는지 · 못 만든 묶음은 넘기지 않는지(DB는 확인 값이 없는 묶음을 처리하지 않는다).
 */
const T = "t1";
const G1 = "20000000-0000-4000-8000-000000000001";
const G2 = "20000000-0000-4000-8000-000000000002";
const R1 = "10000000-0000-4000-8000-000000000001";
const R2 = "10000000-0000-4000-8000-000000000002";
const DOC = "60000000-0000-4000-8000-000000000001";
const check = (rid: string) => ({ refundable: [{ key: `40000000-0000-4000-8000-000000000001#${rid.slice(-1)}`, report: rid }] });

const m = vi.hoisted(() => ({ ready: vi.fn(async () => true),
  calls: [] as [string, Record<string, unknown>][],
  rpc: vi.fn(),
  tables: {} as Record<string, unknown[]>,
  fromOps: [] as [string, unknown[][]][],
  check: vi.fn(),
  log: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/features/audit/server/log", () => ({ logAction: m.log, logActionAs: m.log }));
vi.mock("@/features/slack/server/poke", () => ({ pokeSlack: vi.fn() }));
vi.mock("@/features/withdrawals/server/withdrawal-sheet", () => ({ recordMathWithdrawalToSheet: vi.fn() }));
vi.mock("@/lib/observability/report-error", () => ({ reportError: vi.fn() }));
vi.mock("./completed-target", () => ({ completedEnrollmentIds: async () => [] }));
vi.mock("./refund-check", () => ({ loadGroupRefundCheck: m.check, refundGateReady: () => m.ready(), REFUND_GATE_NOT_READY: "DB 적용 전" }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: (name: string, args: Record<string, unknown>) => {
      m.calls.push([name, args]);
      const res = Promise.resolve().then(() => m.rpc(name, args));
      return { single: () => res, then: (a: (v: unknown) => unknown, b?: (e: unknown) => unknown) => res.then(a, b) };
    },
    from: (table: string) => {
      const ops: unknown[][] = [];
      m.fromOps.push([table, ops]);
      const run = () => Promise.resolve({ data: table === "withdrawal_reports" && ops.some(o => o[0] === "single") ? { id: R1, tenant_id: T, status: "completed", snapshot: { name: "학생" }, effective_date: "2026-11-01" } : m.tables[table] ?? [], error: null });
      const q: Record<string, unknown> = {};
      for (const k of ["select", "eq", "in", "neq", "order", "limit", "or", "lte"]) q[k] = (...a: unknown[]) => { ops.push([k, ...a]); return q; };
      q.single = () => { ops.push(["single"]); return run(); };
      q.then = (a: (v: unknown) => unknown, b?: (e: unknown) => unknown) => run().then(a, b);
      return q;
    },
  }),
}));

import { applyDueWithdrawalReports } from "./scheduled";
import { releaseWithdrawalRefunds } from "./release";

const argsOf = (name: string) => m.calls.filter(([n]) => n === name).map(([, a]) => a);

beforeEach(() => {
  m.calls = []; m.fromOps = []; m.tables = {};
  m.rpc.mockReset(); m.rpc.mockImplementation(async () => ({ data: [], error: null }));
  m.check.mockReset(); m.check.mockImplementation(async (_t: string, gid: string) => check(gid === G1 ? R1 : R2));
  m.log.mockReset();
});

describe("처리일 cron — apply마다 확인 값", () => {
  it("묶음 확인 값을 refundCheck로 apply에 싣는다 · DB가 그대로 돌려주면(결정·데스크 대기) '미룸'", async () => {
    m.tables.withdrawal_reports = [{ id: R1, tenant_id: T, group_id: G1 }];
    m.rpc.mockImplementation(async (name: string) => name === "transition_withdrawal_report" ? { data: { id: R1, status: "scheduled" }, error: null } : { data: [], error: null });
    const out = await applyDueWithdrawalReports();
    expect(argsOf("transition_withdrawal_report")).toEqual([{ p_tenant: T, p_actor: null, p_report: R1, p_action: "apply", p_payload: { refundCheck: check(R1) } }]);
    expect(out).toMatchObject({ applied: 0, deferred: 1 });
  });
  it("🔴 확인 값을 못 만든 묶음은 apply를 부르지 않는다(실패로 센다 · 다음 날 다시)", async () => {
    m.tables.withdrawal_reports = [{ id: R1, tenant_id: T, group_id: G1 }];
    m.check.mockRejectedValue(new Error("down"));
    const out = await applyDueWithdrawalReports();
    expect(argsOf("transition_withdrawal_report")).toEqual([]);
    expect(out.failed).toBeGreaterThanOrEqual(1);
  });
});

describe("release — 묶음마다 확인 값(p_checks)", () => {
  it("요청서(완료 입력·삭제)에 이어진 처리 전 묶음의 확인 값을 p_checks로", async () => {
    m.tables.withdrawal_report_refunds = [{ group_id: G1, tenant_id: T }];
    m.tables.withdrawal_report_groups = [{ id: G1, tenant_id: T }];
    await releaseWithdrawalRefunds({ tenantId: T, documentId: DOC, actorId: "desk" });
    expect(argsOf("release_withdrawal_report_refunds")).toEqual([{ p_tenant: T, p_document: DOC, p_actor: "desk", p_checks: { [G1]: check(R1) } }]);
  });
  it("🔴 확인 값을 못 만든 묶음은 p_checks에 넣지 않는다 · 하나도 없으면 release를 부르지 않는다", async () => {
    m.tables.withdrawal_report_refunds = [{ group_id: G1, tenant_id: T }];
    m.tables.withdrawal_report_groups = [{ id: G1, tenant_id: T }];
    m.check.mockRejectedValue(new Error("down"));
    expect(await releaseWithdrawalRefunds({ tenantId: T, documentId: DOC, actorId: "desk" })).toEqual({ released: 0, blocked: 0, failed: 1 });
    expect(argsOf("release_withdrawal_report_refunds")).toEqual([]);
  });
  it("cron 안전망 — 승인이 다 끝난 진행 중 묶음 · 처리일이 된 예약만 후보 · 처리 결과마다 감사로그", async () => {
    m.tables.withdrawal_report_groups = [
      { id: G1, tenant_id: T, status: "pending", effective_date: "2026-11-01" },
      { id: G2, tenant_id: T, status: "scheduled", effective_date: "2999-01-01" },
    ];
    m.tables.withdrawal_reports = [];  // 승인 안 된 보고서 없음
    m.rpc.mockImplementation(async (name: string) => name === "release_withdrawal_report_refunds"
      ? { data: [{ reportId: R1, groupId: G1, tenantId: T, status: "completed", groupStatus: "completed" }], error: null } : { data: [], error: null });
    const out = await releaseWithdrawalRefunds({ tenantId: null, documentId: null, actorId: null });
    expect(argsOf("release_withdrawal_report_refunds")).toEqual([{ p_tenant: null, p_document: null, p_actor: null, p_checks: { [G1]: check(R1) } }]);
    expect(out).toMatchObject({ released: 1, failed: 0 });
    expect(m.log).toHaveBeenCalledWith(expect.objectContaining({ actorName: "시스템(환불 확인 뒤 처리)" }), expect.objectContaining({ metadata: expect.objectContaining({ operation: "환불 확인 뒤 처리" }) }));
  });
  it("🔴 묶음마다 확인 값을 계산하고 **바로** release를 부른다(리뷰 #14 — 다 계산한 뒤 한 번에 부르면 앞 묶음 확인 값이 낡는다)", async () => {
    m.tables.withdrawal_report_groups = [
      { id: G1, tenant_id: T, status: "pending", effective_date: "2026-11-01" },
      { id: G2, tenant_id: T, status: "scheduled", effective_date: "2026-11-01" },
    ];
    m.tables.withdrawal_reports = [];
    const order: string[] = [];
    m.check.mockImplementation(async (_t: string, gid: string) => { order.push(`check:${gid}`); return check(R1); });
    m.rpc.mockImplementation(async (name: string, args: { p_checks?: Record<string, unknown> }) => {
      if (name === "release_withdrawal_report_refunds") order.push(`release:${Object.keys(args.p_checks ?? {}).join(",")}`);
      return { data: [], error: null };
    });
    await releaseWithdrawalRefunds({ tenantId: null, documentId: null, actorId: null });
    expect(order).toEqual([`check:${G1}`, `release:${G1}`, `check:${G2}`, `release:${G2}`]);
  });
  it("🔴 DB 준비 전(새 앱 + 옛 DB)이면 release·처리일 apply를 부르지 않는다(리뷰 #5)", async () => {
    m.ready.mockResolvedValue(false);
    m.tables.withdrawal_report_refunds = [{ group_id: G1, tenant_id: T }];
    m.tables.withdrawal_report_groups = [{ id: G1, tenant_id: T }];
    m.tables.withdrawal_reports = [{ id: R1, tenant_id: T, group_id: G1 }];
    await releaseWithdrawalRefunds({ tenantId: T, documentId: DOC, actorId: "desk" });
    expect((await applyDueWithdrawalReports()).failed).toBe(1);
    expect(argsOf("release_withdrawal_report_refunds")).toEqual([]);
    expect(argsOf("transition_withdrawal_report")).toEqual([]);
    m.ready.mockResolvedValue(true);
  });
  it("승인이 남은 진행 중 묶음은 후보가 아니다", async () => {
    m.tables.withdrawal_report_groups = [{ id: G1, tenant_id: T, status: "pending", effective_date: "2026-11-01" }];
    m.tables.withdrawal_reports = [{ group_id: G1, status: "manager_pending" }];
    await releaseWithdrawalRefunds({ tenantId: null, documentId: null, actorId: null });
    expect(m.check).not.toHaveBeenCalled();
    expect(argsOf("release_withdrawal_report_refunds")).toEqual([]);
  });
});
