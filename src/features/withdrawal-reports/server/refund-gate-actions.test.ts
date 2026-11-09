import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_BODY } from "../model";

/**
 * 원장 환불 결정(원장 2026-11-06 · DB s2_0037) — 서버 동작이 **처리할 수 있는 요청마다** 같은 요청에서 계산한 환불 확인 값을 DB에 넘기는지,
 * 못 만들면 처리를 맡기지 않는지(닫힘), 원장 결정 동작이 권한·화면이 본 줄·지정 데스크를 지키는지. DB는 모의(부른 함수와 인자만 본다).
 * 확인 값이 없을 때 DB가 처리하지 않는 것 자체는 SQL 시험(refund-decision-gate-sql.test.ts)과 PGlite 확인(마이그레이션 머리말)이 본다.
 */
const REPORT_ID = "10000000-0000-4000-8000-000000000001";
const GROUP_ID = "20000000-0000-4000-8000-000000000001";
const DESK = "30000000-0000-4000-8000-000000000001";
const OTHER_DESK = "30000000-0000-4000-8000-000000000002";
const INV = "40000000-0000-4000-8000-000000000001";
const K0 = `${INV}#a0`, K1 = `${INV}#a1`;
const CHECK = { refundable: [{ key: K0, report: REPORT_ID }, { key: K1, report: REPORT_ID }] };

const m = vi.hoisted(() => ({ ready: vi.fn(async () => true),
  viewer: null as null | Record<string, unknown>,
  record: null as null | { report: Record<string, unknown>; consultations: unknown[] },
  calls: [] as [string, Record<string, unknown>][],
  rpc: vi.fn(),
  from: vi.fn(),
  check: vi.fn(),
  later: vi.fn(),
  desks: vi.fn(),
  releaseGroup: vi.fn(),
  logAction: vi.fn(),
  notify: vi.fn(),
  status: vi.fn(),
  holdAfter: null as null | { hold: boolean },
  decisions: new Map() as Map<string, Record<string, unknown>>,
  claimed: vi.fn(async () => false),
  link: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => (m.viewer as { user: unknown } | null)?.user ?? null }));
vi.mock("@/features/audit/server/log", () => ({ logAction: m.logAction }));
vi.mock("@/features/notifications/server/notify", () => ({ notifyUsers: m.notify }));
vi.mock("@/features/slack/server/poke", () => ({ pokeSlack: vi.fn() }));
vi.mock("@/features/withdrawals/server/withdrawal-sheet", () => ({ recordMathWithdrawalToSheet: vi.fn() }));
vi.mock("@/features/students/server/status-access", () => ({ canManageStudentStatusNow: m.status }));
vi.mock("./completed-target", () => ({ completedEnrollmentIds: async () => [] }));
vi.mock("./billing", () => ({ loadReportBilling: async () => ({ tuition: "", arrears: "no", arrearsNote: "" }) }));
vi.mock("./queries", () => ({ reportViewer: async () => m.viewer, getReport: async () => m.record, getReportForSave: async () => m.record }));
vi.mock("./refund-check", () => ({ loadGroupRefundCheck: m.check, refundGateReady: () => m.ready(), REFUND_GATE_NOT_READY: "DB 적용 전", loadRefundDecisions: async () => m.decisions, loadRefundHolds: async () => new Map(),
  loadRefundHoldState: async () => m.holdAfter }));
vi.mock("./release", () => ({ releaseWithdrawalGroup: m.releaseGroup, releaseWithdrawalRefunds: vi.fn() }));
vi.mock("./refund", async (orig) => ({ ...(await orig<typeof import("./refund")>()), loadLaterInvoices: m.later, loadDeskStaff: m.desks, claimedEarlier: () => m.claimed() }));
vi.mock("./refund-steps", async (orig) => ({ ...(await orig<typeof import("./refund-steps")>()), loadRefundLink: m.link }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: (name: string, args: Record<string, unknown>) => {
      m.calls.push([name, args]);
      const res = Promise.resolve().then(() => m.rpc(name, args));
      return { single: () => res, then: (a: (v: unknown) => unknown, b?: (e: unknown) => unknown) => res.then(a, b) };
    },
    from: (table: string) => {
      const ops: unknown[][] = [];
      const run = () => Promise.resolve().then(() => m.from(table, ops));
      const q: Record<string, unknown> = {};
      for (const k of ["select", "eq", "in", "neq", "order", "limit", "insert", "delete", "update", "or", "lte", "is"]) q[k] = (...a: unknown[]) => { ops.push([k, ...a]); return q; };
      q.single = run; q.maybeSingle = run;
      q.then = (a: (v: unknown) => unknown, b?: (e: unknown) => unknown) => run().then(a, b);
      return q;
    },
  }),
}));

import { changeWithdrawalReport, processWithdrawalDirectly } from "./actions";
import { approveWithdrawalRefund, declineWithdrawalRefund, recheckWithdrawalRefund } from "./refund-actions";
import { separateWithdrawalRefundIncrease } from "./refund-separate-actions";

const today = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
const baseReport = { id: REPORT_ID, tenant_id: "t1", student_id: "s1", group_id: GROUP_ID, group_leader: true, teacher_id: "teacher", requested_by: "req", manager_id: "mgr", manager_ids: ["mgr"],
  director_id: null, status: "manager_pending", revision: 3, exit_kind: "withdrawal", subjects: ["math"], effective_date: today, body: { ...EMPTY_BODY }, snapshot: { name: "학생", courses: [] }, created_at: "", updated_at: "" };
const line = (key: string, paid: number) => ({ kind: "수업", description: key.endsWith("a0") ? "수학 반" : "차량비", amount: paid, discount: 0, paid, key, paidNet: paid, billingRefund: false, refund: null });
const later = [{ id: INV, period: "2026-12", category: "tuition", status: "paid", amountBilled: 300000, amountPaid: 300000, partial: false, lines: [line(K0, 200000), line(K1, 100000)] }];
const rpcNames = () => m.calls.map(([n]) => n);
const argsOf = (name: string) => m.calls.find(([n]) => n === name)?.[1];

beforeEach(() => {
  m.calls = [];
  m.viewer = { writable: true, user: { id: "mgr", tenantId: "t1", systemRole: "admin", displayName: "관리자" }, teacherId: null, request: true, scope: null };
  m.record = { report: { ...baseReport }, consultations: [] };
  m.rpc.mockReset(); m.rpc.mockImplementation(async (name: string) => ({ data: name === "transition_withdrawal_report" ? { ...baseReport, status: "approved", revision: 4 } : null, error: null }));
  m.from.mockReset(); m.from.mockImplementation(async () => ({ data: null, error: null }));
  m.check.mockReset(); m.check.mockResolvedValue(CHECK);
  m.later.mockReset(); m.later.mockResolvedValue(later);
  m.desks.mockReset(); m.desks.mockResolvedValue({ staff: [{ id: DESK, name: "데스크" }], designated: true });
  m.releaseGroup.mockReset(); m.releaseGroup.mockResolvedValue({ released: 1, blocked: 0, failed: 0 });
  m.logAction.mockReset(); m.notify.mockReset();
  m.status.mockReset(); m.status.mockResolvedValue(true);
  m.ready.mockReset(); m.ready.mockResolvedValue(true);
  m.decisions = new Map();
  m.claimed.mockReset(); m.claimed.mockResolvedValue(false);
  m.link.mockReset(); m.link.mockResolvedValue({ deskId: DESK, deskName: "데스크", deskActive: true });
});

describe("제출·승인 — 같은 요청에서 계산한 환불 확인 값을 처리 함수에 넘긴다", () => {
  it("승인: 묶음 확인 값을 refundCheck로", async () => {
    expect(await changeWithdrawalReport(REPORT_ID, "approve", 3)).toEqual({ ok: true, id: REPORT_ID });
    expect(m.check).toHaveBeenCalledWith("t1", GROUP_ID);
    expect(argsOf("transition_withdrawal_report")).toMatchObject({ p_action: "approve", p_payload: { revision: 3, refundCheck: CHECK } });
  });
  it("제출(관리자 승인 생략이면 제출이 곧 승인)도 refundCheck를 싣는다", async () => {
    m.viewer = { ...m.viewer!, user: { id: "teacher", tenantId: "t1", systemRole: "teacher", displayName: "강사" } };
    m.record = { report: { ...baseReport, status: "requested", manager_id: null, manager_ids: [] }, consultations: [] };
    const body = { ...EMPTY_BODY, reason: "relocation", detail: "가".repeat(120), studentConsultation: "a", parentConsultation: "b", teacherOpinion: "c" };
    expect(await changeWithdrawalReport(REPORT_ID, "submit", 3, body)).toEqual({ ok: true, id: REPORT_ID });
    expect(argsOf("transition_withdrawal_report")).toMatchObject({ p_action: "submit", p_payload: { refundCheck: CHECK } });
  });
  it("🔴 확인 값을 못 만들면 처리 함수를 부르지 않는다(승인만 남고 처리가 밀리는 일이 없게 — 다시 하게 한다)", async () => {
    m.check.mockRejectedValue(new Error("invoices down"));
    expect(await changeWithdrawalReport(REPORT_ID, "approve", 3)).toEqual({ error: "환불할 수 있는 청구를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요." });
    expect(rpcNames()).not.toContain("transition_withdrawal_report");
  });
  it("🔴 DB 준비 전(새 앱 + 옛 DB)이면 처리 함수를 부르지 않는다 — 'DB 적용 전'(리뷰 #5)", async () => {
    m.ready.mockResolvedValue(false);
    expect(await changeWithdrawalReport(REPORT_ID, "approve", 3)).toEqual({ error: "DB 적용 전" });
    expect(rpcNames()).toEqual([]);
    expect(m.check).not.toHaveBeenCalled();
  });
  it("전원 승인인데 묶음이 기다리면 감사로그에 그 까닭(refundWait — 리뷰 #8)", async () => {
    m.from.mockImplementation(async (table: string) => table === "withdrawal_report_groups" ? { data: { status: "pending", refund_hold: true }, error: null }
      : table === "withdrawal_reports" ? { data: [{ status: "approved" }], error: null } : { data: null, error: null });
    await changeWithdrawalReport(REPORT_ID, "approve", 3);
    expect(m.logAction).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ refundWait: "원장 환불 결정 대기" }) }));
    m.logAction.mockReset();
    m.from.mockImplementation(async (table: string) => table === "withdrawal_report_groups" ? { data: { status: "pending", refund_hold: false }, error: null }
      : table === "withdrawal_reports" ? { data: [{ status: "approved" }, { status: "manager_pending" }], error: null } : { data: null, error: null });
    await changeWithdrawalReport(REPORT_ID, "approve", 3);
    expect(m.logAction).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.not.objectContaining({ refundWait: expect.anything() }) }));
  });
  it("반려·취소는 처리로 이어지지 않는다 — 확인 값을 계산하지 않는다", async () => {
    await changeWithdrawalReport(REPORT_ID, "reject", 3, "고쳐 주세요");
    expect(m.check).not.toHaveBeenCalled();
    expect((argsOf("transition_withdrawal_report")?.p_payload as Record<string, unknown>).refundCheck).toBeUndefined();
  });
});

describe("바로 처리 — DB 안의 apply는 확인 값이 없어 미룬다 → 같은 요청에서 확인 값과 apply", () => {
  const direct = { studentId: "50000000-0000-4000-8000-000000000001", enrollmentIds: [], effectiveDate: today, reason: "relocation", memo: "이사" };
  beforeEach(() => {
    m.viewer = { ...m.viewer!, user: { id: "req", tenantId: "t1", systemRole: "manager", displayName: "매니저" } };
    m.rpc.mockImplementation(async (name: string) => name === "direct_withdrawal_report" ? { data: REPORT_ID, error: null }
      : { data: { ...baseReport, status: "completed", direct: true }, error: null });
    m.from.mockImplementation(async (table: string) => table === "withdrawal_reports" ? { data: { ...baseReport, status: "scheduled", direct: true }, error: null } : { data: null, error: null });
  });
  it("처리일이 오늘 이전이면 refundCheck와 apply(행위자 = 처리한 사람)", async () => {
    expect(await processWithdrawalDirectly(direct)).toEqual({ ok: true, id: REPORT_ID });
    expect(rpcNames()).toEqual(["direct_withdrawal_report", "transition_withdrawal_report"]);
    expect(argsOf("transition_withdrawal_report")).toMatchObject({ p_actor: "req", p_action: "apply", p_payload: { refundCheck: CHECK } });
  });
  it("원장 결정 전이면(DB가 그대로 돌려줌) 감사로그에 '원장 환불 결정 대기'", async () => {
    m.rpc.mockImplementation(async (name: string) => name === "direct_withdrawal_report" ? { data: REPORT_ID, error: null } : { data: { ...baseReport, status: "scheduled", direct: true }, error: null });
    await processWithdrawalDirectly(direct);
    expect(m.logAction).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ refundWait: "원장 환불 결정 대기" }) }));
  });
  it("🔴 DB 준비 전이면 바로 처리 함수를 **부르기 전에** 거절(리뷰 #5)", async () => {
    m.ready.mockResolvedValue(false);
    expect(await processWithdrawalDirectly(direct)).toEqual({ error: "DB 적용 전" });
    expect(rpcNames()).toEqual([]);
  });
  it("🔴 확인 값을 못 만들면 apply를 부르지 않는다(처리 예약으로 남고 cron이 다시 계산)", async () => {
    m.check.mockRejectedValue(new Error("down"));
    expect(await processWithdrawalDirectly(direct)).toEqual({ ok: true, id: REPORT_ID });
    expect(rpcNames()).toEqual(["direct_withdrawal_report"]);
  });
  it("미래 날짜면 처리 예약 그대로(apply 없음)", async () => {
    m.from.mockImplementation(async () => ({ data: { ...baseReport, status: "scheduled", direct: true, effective_date: "2999-01-01" }, error: null }));
    await processWithdrawalDirectly({ ...direct, effectiveDate: "2999-01-01" });
    expect(rpcNames()).toEqual(["direct_withdrawal_report"]);
  });
});

describe("원장 환불 승인 — 지정 데스크만 · 고르지 않은 줄은 환불하지 않음 · 확인 값", () => {
  beforeEach(() => {
    m.viewer = { ...m.viewer!, user: { id: "boss", tenantId: "t1", systemRole: "master", displayName: "원장" } };
    m.rpc.mockImplementation(async (name: string) => ({ data: name === "attach_withdrawal_report_refund" ? { attached: true, gates: true } : name === "refund_desk_task_open" ? "task" : null, error: null }));
    m.from.mockImplementation(async (table: string, ops: unknown[][]) => table === "academy_documents" && ops.some(o => o[0] === "insert") ? { data: { id: "doc1" }, error: null } : { data: [], error: null });
  });
  it("🔴 학원 설정에 데스크 담당자가 없으면 막는다 — 요청서를 만들지 않는다(대체 없음)", async () => {
    m.desks.mockResolvedValue({ staff: [], designated: false });
    expect(await approveWithdrawalRefund(REPORT_ID, [K0], DESK, [K1])).toEqual({ error: "학원 설정에서 데스크 담당자를 먼저 지정해 주세요" });
    expect(m.from.mock.calls.some(([t, ops]) => t === "academy_documents" && (ops as unknown[][]).some(o => o[0] === "insert"))).toBe(false);
    expect(rpcNames()).toEqual([]);
  });
  it("지정 명단 밖(또는 수납 쓰기 권한 없는) 사람은 고를 수 없다", async () => {
    expect((await approveWithdrawalRefund(REPORT_ID, [K0], OTHER_DESK, [K1])) as { error: string }).toMatchObject({ error: expect.stringContaining("학원 설정에 지정된 데스크 담당자") });
    expect(rpcNames()).toEqual([]);
  });
  it("🔴 화면이 본 '고르지 않은 줄'이 지금 줄과 다르면 거절(원장이 보지 않은 줄을 환불하지 않음으로 남기지 않는다)", async () => {
    expect(await approveWithdrawalRefund(REPORT_ID, [K0], DESK, [])).toEqual({ error: "퇴원월 뒤 청구가 바뀌었습니다. 새로고침 후 다시 골라 주세요." });
    expect(rpcNames()).toEqual([]);
  });
  it("연결 함수에 고르지 않은 줄(p_none)과 확인 값(p_check)을 함께 · 감사로그에 '환불하지 않음' 줄", async () => {
    expect(await approveWithdrawalRefund(REPORT_ID, [K0], DESK, [K1])).toEqual({ ok: true, documentId: "doc1", gates: true, undecided: null });
    expect(argsOf("attach_withdrawal_report_refund")).toMatchObject({ p_desk: DESK, p_none: [K1], p_check: CHECK, p_expect_gate: true });
    expect(m.logAction).toHaveBeenCalledWith(expect.objectContaining({ action: "withdrawal_refund_approve", metadata: expect.objectContaining({ notRefunded: ["2026-12 차량비 100,000원"] }) }));
  });
  it("연결 함수가 센 결정 안 된 줄을 화면에 넘긴다(다른 보고서에 남은 결정 — 리뷰 r2 m12)", async () => {
    m.rpc.mockImplementation(async (name: string) => ({ data: name === "attach_withdrawal_report_refund" ? { attached: true, gates: true, undecided: 2 } : name === "refund_desk_task_open" ? "task" : null, error: null }));
    expect(await approveWithdrawalRefund(REPORT_ID, [K0], DESK, [K1])).toEqual({ ok: true, documentId: "doc1", gates: true, undecided: 2 });
  });
  it("🔴 학원 설정을 못 읽었으면(접힘) '데스크를 지정하세요'가 아니라 다시 시도(리뷰 r2 m7)", async () => {
    m.desks.mockResolvedValue({ staff: [], designated: false, folded: true });
    expect(await approveWithdrawalRefund(REPORT_ID, [K0], DESK, [K1])).toEqual({ error: "학원 설정을 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요." });
  });
  it("🔴 무효(void) 청구의 낸 돈 줄도 요청서 결제내역에 남는다 — 달 옆 '무효 청구' · 총 환불금액과 맞게(리뷰 r2 (c) · 결제내역 서식은 void를 통째로 뺀다)", async () => {
    m.later.mockResolvedValue([{ ...later[0]!, status: "void" }]);
    expect(await approveWithdrawalRefund(REPORT_ID, [K0], DESK, [K1])).toEqual({ ok: true, documentId: "doc1", gates: true, undecided: null });
    const inserted = m.from.mock.calls.flatMap(([t, ops]) => (t === "academy_documents" ? (ops as unknown[][]).filter((o) => o[0] === "insert") : []))[0]?.[1] as
      { form_data: { refund: { paymentDetails: string; totalAmount: string } } } | undefined;
    expect(inserted?.form_data.refund.totalAmount).toBe("200,000원");
    expect(inserted?.form_data.refund.paymentDetails).toMatch(/^2026-12 무효 청구 수업 수학 반 200,000원 납부/);
    // 무효가 아닌 청구는 종전 그대로(달만)
    m.later.mockResolvedValue(later);
    m.from.mockClear();
    await approveWithdrawalRefund(REPORT_ID, [K0], DESK, [K1]);
    const plain = m.from.mock.calls.flatMap(([t, ops]) => (t === "academy_documents" ? (ops as unknown[][]).filter((o) => o[0] === "insert") : []))[0]?.[1] as
      { form_data: { refund: { paymentDetails: string } } } | undefined;
    expect(plain?.form_data.refund.paymentDetails).toMatch(/^2026-12 수업 수학 반 200,000원 납부/);
  });
  it("🔴 다른 요청의 요청서가 담은 줄(환불 완료·진행 중)은 고를 수 없다 — 요청서를 만들지 않는다(같은 돈 두 번 · 팀장 결정 2026-11-06)", async () => {
    const withOther = (canceled: boolean, completed: boolean) => [{ ...later[0]!, lines: [{ ...later[0]!.lines[0]!, otherRefund: { documentId: "old", deskName: null, canceled, completed } }, later[0]!.lines[1]!] }];
    m.later.mockResolvedValue(withOther(false, true));
    expect((await approveWithdrawalRefund(REPORT_ID, [K0], DESK, [K1])) as { error: string }).toMatchObject({ error: expect.stringContaining("다른 요청의 요청서가 이미 담은 건") });
    m.later.mockResolvedValue(withOther(false, false));
    expect((await approveWithdrawalRefund(REPORT_ID, [K0], DESK, [K1])) as { error: string }).toMatchObject({ error: expect.stringContaining("다른 요청의 요청서가 이미 담은 건") });
    expect(rpcNames()).toEqual([]);
    // 취소된 요청의 환불 전 요청서면 다시 승인할 수 있다 — 대체되는 옛 요청서 id를 함께 넘긴다(리뷰 r2 D-1 ⅰ · 수납명이 바뀌어도 C.3가 문서 id로 막는다)
    m.later.mockResolvedValue(withOther(true, false));
    expect(await approveWithdrawalRefund(REPORT_ID, [K0], DESK, [K1])).toEqual({ ok: true, documentId: "doc1", gates: true, undecided: null });
    expect(argsOf("attach_withdrawal_report_refund")).toMatchObject({ p_supersedes: ["old"] });
  });
  it("🔴 금액 모름 미배분 줄은 환불 승인으로 고를 수 없다(리뷰 r2 I5 — 화면을 지나도 서버가 거절)", async () => {
    m.later.mockResolvedValue([{ ...later[0]!, lines: [{ ...later[0]!.lines[0]!, amountUnknown: true }, later[0]!.lines[1]!] }]);
    expect((await approveWithdrawalRefund(REPORT_ID, [K0], DESK, [K1])) as { error: string }).toMatchObject({ error: expect.stringContaining("금액을 알 수 없는 미배분 납부") });
    expect(rpcNames()).toEqual([]);
  });
  it("🔴 다시 승인 — 이전 환불 완료 기록·따로 환불을 빼고 요청(총액 · 결제내역은 실제 낸 돈 + '※ … 빼고 요청' 줄 · 리뷰 r3 R2-I2 · DB attach와 같은 식) · 남은 돈이 없으면 거절", async () => {
    m.decisions = new Map([[K0, { decision: "refund", live: false, refundedTotal: 150000, separateAmount: 20000 }]]);
    expect(await approveWithdrawalRefund(REPORT_ID, [K0], DESK, [K1])).toEqual({ ok: true, documentId: "doc1", gates: true, undecided: null });
    const inserted = m.from.mock.calls.flatMap(([t, ops]) => (t === "academy_documents" ? (ops as unknown[][]).filter((o) => o[0] === "insert") : []))[0]?.[1] as
      { form_data: { refund: { paymentDetails: string; totalAmount: string } } } | undefined;
    expect(inserted?.form_data.refund.totalAmount).toBe("30,000원");
    expect(inserted?.form_data.refund.paymentDetails).toMatch(/^2026-12 수업 수학 반 200,000원 납부/);
    expect(inserted?.form_data.refund.paymentDetails).toContain("※ 2026-12 수학 반 — 이전 환불 완료 기록·따로 환불 170,000원은 빼고 요청");
    expect(m.logAction).toHaveBeenCalledWith(expect.objectContaining({ action: "withdrawal_refund_approve",
      metadata: expect.objectContaining({ items: ["2026-12 수학 반 30,000원(낸 돈 200,000원 − 이전 환불·따로 환불 170,000원)"] }) }));
    m.calls = []; m.from.mockClear();
    m.decisions = new Map([[K0, { decision: "refund", live: false, refundedTotal: 200000 }]]);
    expect((await approveWithdrawalRefund(REPORT_ID, [K0], DESK, [K1])) as { error: string }).toMatchObject({ error: expect.stringContaining("환불할 남은 돈이 없습니다") });
    expect(rpcNames()).toEqual([]);
    expect(m.from.mock.calls.some(([t]) => t === "academy_documents")).toBe(false);
  });
  it("🔴 동시 승인 확인 조회가 실패하면 만든 요청서를 지우고 거절한다(닫힌 쪽 · 리뷰 r3 R-1) · 지우지 못하면 남았다고 알린다", async () => {
    m.claimed.mockRejectedValue(new Error("timeout"));
    expect(await approveWithdrawalRefund(REPORT_ID, [K0], DESK, [K1])).toEqual({ error: "같은 건이 다른 창에서 승인됐는지 확인하지 못해 요청서를 만들지 않았습니다. 잠시 후 다시 시도해 주세요." });
    expect(m.from.mock.calls.some(([t, ops]) => t === "academy_documents" && (ops as unknown[][]).some((o) => o[0] === "delete"))).toBe(true);
    expect(rpcNames()).not.toContain("attach_withdrawal_report_refund");
    expect(m.notify).not.toHaveBeenCalled();
    m.from.mockImplementation(async (table: string, ops: unknown[][]) => table === "academy_documents" && ops.some(o => o[0] === "insert") ? { data: { id: "doc1" }, error: null }
      : table === "academy_documents" && ops.some(o => o[0] === "delete") ? { data: null, error: { message: "down" } } : { data: [], error: null });
    expect(await approveWithdrawalRefund(REPORT_ID, [K0], DESK, [K1])).toEqual({ error: "겹친 승인이 있는지 확인하지 못했고, 만든 환불 요청서가 남았습니다. 환불 요청 목록에서 확인해 주세요." });
    expect(m.logAction).toHaveBeenCalledWith(expect.objectContaining({ action: "refund_request_create", metadata: expect.objectContaining({ source: expect.stringContaining("겹침 확인 실패") }) }));
  });
  it("🔴 늘어난 몫 줄이 정해지지 않았으면(처리 전) 다른 줄의 환불 승인을 거절한다 — 요청서를 만들지 않는다(리뷰 r3 R3-I1 · 화면과 같은 글) · 처리 끝난 보고서는 막지 않는다", async () => {
    const DOC = "50000000-0000-4000-8000-0000000000aa";
    m.later.mockResolvedValue([{ ...later[0]!, lines: [{ ...line(K0, 200000), paidNet: 250000, refund: { documentId: DOC, deskName: "데스크", completed: true, exact: true } }, line(K1, 100000)] }]);
    m.decisions = new Map([[K0, { decision: "refund", live: true, paidNet: 200000, paidSeen: 200000, documentId: DOC }]]);
    m.record = { report: { ...baseReport, status: "approved" }, consultations: [] };
    expect(await approveWithdrawalRefund(REPORT_ID, [K1], DESK, [K0])).toEqual({ error: "늘어난 몫 50,000원 줄을 먼저 정하세요 — 따로 처리 또는 환불 없음." });
    expect(rpcNames()).toEqual([]);
    expect(m.from.mock.calls.some(([t]) => t === "academy_documents")).toBe(false);
    m.record = { report: { ...baseReport, status: "completed" }, consultations: [] };
    expect(await approveWithdrawalRefund(REPORT_ID, [K1], DESK, [K0])).toMatchObject({ ok: true });
  });
  it("대체할 옛 요청서가 없으면 빈 목록", async () => {
    expect(await approveWithdrawalRefund(REPORT_ID, [K0], DESK, [K1])).toEqual({ ok: true, documentId: "doc1", gates: true, undecided: null });
    expect(argsOf("attach_withdrawal_report_refund")).toMatchObject({ p_supersedes: [] });
  });
  it("확인 값을 못 만들면 요청서를 만들지 않는다", async () => {
    m.check.mockRejectedValue(new Error("down"));
    expect((await approveWithdrawalRefund(REPORT_ID, [K0], DESK, [K1])) as { error: string }).toMatchObject({ error: expect.stringContaining("확인하지 못했습니다") });
    expect(rpcNames()).toEqual([]);
  });
});

describe("원장 결정 2026-11-09 — '환불하지 않음 — 늘어난 몫은 수납에서 따로 처리'", () => {
  const DOC = "50000000-0000-4000-8000-000000000001";
  const doneLater = (paid: number, completed = true) => [{ ...later[0]!, lines: [{ ...line(K0, 200000), paidNet: paid, refund: { documentId: DOC, deskName: "데스크", completed, exact: true } }, line(K1, 100000)] }];
  beforeEach(() => {
    m.viewer = { ...m.viewer!, user: { id: "boss", tenantId: "t1", systemRole: "master", displayName: "원장" } };
    m.record = { report: { ...baseReport, status: "approved" }, consultations: [] };
    m.later.mockResolvedValue(doneLater(250000));
    m.decisions = new Map([[K0, { decision: "refund", live: true, paidNet: 200000, paidSeen: 200000, documentId: DOC }]]);
    m.rpc.mockImplementation(async () => ({ data: { groupId: GROUP_ID, undecided: 0, ready: true, separate: 50000 }, error: null }));
  });
  it("🔴 그 줄만 정하고 늘어난 몫을 DB에(p_none = p_separate = 그 줄 · 같은 확인 값) → 처리할 차례면 이어서 처리 · 감사로그 · 담당 데스크 알림(표식 쓰지 말라는 안내)", async () => {
    expect(await separateWithdrawalRefundIncrease(REPORT_ID, K0)).toEqual({ ok: true, processed: true, undecided: 0, amount: 50000, notified: true });
    expect(argsOf("decide_withdrawal_report_refund")).toEqual({ p_tenant: "t1", p_actor: "boss", p_report: REPORT_ID, p_none: [K0], p_check: CHECK, p_separate: [K0] });
    expect(m.releaseGroup).toHaveBeenCalledWith({ tenantId: "t1", groupId: GROUP_ID, actorId: "boss", check: CHECK });
    expect(m.logAction).toHaveBeenCalledWith(expect.objectContaining({ action: "withdrawal_refund_separate",
      metadata: expect.objectContaining({ documentId: DOC, item: "2026-12 수학 반", before: 200000, now: 250000, amount: 50000, next: "이어서 처리" }) }));
    expect(m.notify).toHaveBeenCalledWith([expect.objectContaining({ recipientId: DESK, type: "refund_request_approved", link: "/billing/refunds/new",
      body: expect.stringContaining("설명에 '퇴원보고서 환불 승인 ·'을 쓰지 마세요") })]);
  });
  it("처리할 차례가 아니면 처리하지 않는다 · 담당 데스크가 퇴사했거나 못 읽으면 알리지 않는다(결정은 남는다)", async () => {
    m.rpc.mockImplementation(async () => ({ data: { groupId: GROUP_ID, undecided: 1, ready: false, separate: 50000 }, error: null }));
    m.link.mockResolvedValue({ deskId: DESK, deskName: "데스크", deskActive: false });
    // 알리지 못했으면 결과에 그대로(리뷰 r3 R3-m2 — 화면이 '알림'이라고 말하지 않게)
    expect(await separateWithdrawalRefundIncrease(REPORT_ID, K0)).toEqual({ ok: true, processed: false, undecided: 1, amount: 50000, notified: false });
    expect(m.releaseGroup).not.toHaveBeenCalled();
    expect(m.notify).not.toHaveBeenCalled();
    m.link.mockRejectedValue(new Error("down"));
    expect(await separateWithdrawalRefundIncrease(REPORT_ID, K0)).toMatchObject({ ok: true });
    expect(m.notify).not.toHaveBeenCalled();
  });
  it("🔴 환불을 마친 요청서의 '환불' 줄·늘어난 줄이 아니면 DB를 부르지 않는다 · 원장급만 · 처리 전만 · 관문 SQL 적용 뒤만", async () => {
    m.later.mockResolvedValue(doneLater(250000, false));   // 요청서가 환불 전
    expect((await separateWithdrawalRefundIncrease(REPORT_ID, K0)) as { error: string }).toMatchObject({ error: expect.stringContaining("환불을 마친 요청서의 줄 중 그 뒤 낸 돈이 는 줄뿐") });
    m.later.mockResolvedValue(doneLater(200000));          // 늘지 않음
    expect((await separateWithdrawalRefundIncrease(REPORT_ID, K0)) as { error: string }).toMatchObject({ error: expect.stringContaining("그 뒤 낸 돈이 는 줄뿐") });
    m.later.mockResolvedValue(doneLater(250000));
    expect((await separateWithdrawalRefundIncrease(REPORT_ID, K1)) as { error: string }).toMatchObject({ error: expect.stringContaining("그 뒤 낸 돈이 는 줄뿐") });
    m.viewer = { ...m.viewer!, user: { id: "mgr", tenantId: "t1", systemRole: "admin", displayName: "관리자" } };
    expect(await separateWithdrawalRefundIncrease(REPORT_ID, K0)).toEqual({ error: "환불 결정은 원장만 할 수 있습니다." });
    m.viewer = { ...m.viewer!, user: { id: "boss", tenantId: "t1", systemRole: "master", displayName: "원장" }, teacherId: "boss" };
    expect(await separateWithdrawalRefundIncrease(REPORT_ID, K0)).toEqual({ error: "환불 결정은 원장만 할 수 있습니다." });
    m.viewer = { ...m.viewer!, teacherId: null };
    m.record = { report: { ...baseReport, status: "completed" }, consultations: [] };
    expect(await separateWithdrawalRefundIncrease(REPORT_ID, K0)).toEqual({ error: "처리 전 퇴원보고서에서만 정할 수 있습니다." });
    m.record = { report: { ...baseReport, status: "approved" }, consultations: [] };
    m.ready.mockResolvedValue(false);
    expect(await separateWithdrawalRefundIncrease(REPORT_ID, K0)).toEqual({ error: "DB 적용 전" });
    expect(await separateWithdrawalRefundIncrease(REPORT_ID, "x")).toEqual({ error: "요청 내용을 확인해 주세요." });
    expect(rpcNames()).toEqual([]);
    expect(m.logAction).not.toHaveBeenCalled();
  });
  it("DB가 거절하면(그 사이 바뀜) 그 문구를 그대로 · 감사로그·알림 없음", async () => {
    m.rpc.mockImplementation(async () => ({ data: null, error: { message: "늘어난 몫을 따로 환불할 수 있는 건은 …", code: "P0001" } }));
    expect(await separateWithdrawalRefundIncrease(REPORT_ID, K0)).toEqual({ error: "늘어난 몫을 따로 환불할 수 있는 건은 …" });
    expect(m.logAction).not.toHaveBeenCalled();
    expect(m.notify).not.toHaveBeenCalled();
  });
});

describe("원장 '환불 없음'", () => {
  beforeEach(() => {
    m.viewer = { ...m.viewer!, user: { id: "boss", tenantId: "t1", systemRole: "master", displayName: "원장" } };
    m.record = { report: { ...baseReport, status: "approved" }, consultations: [] };
    m.rpc.mockImplementation(async () => ({ data: { groupId: GROUP_ID, undecided: 0, ready: true }, error: null }));
  });
  it("원장급만 — 관리자는 거절(DB도 행위자 역할을 본다)", async () => {
    m.viewer = { ...m.viewer!, user: { id: "mgr", tenantId: "t1", systemRole: "admin", displayName: "관리자" } };
    expect(await declineWithdrawalRefund(REPORT_ID, [K0, K1])).toEqual({ error: "환불 결정은 원장만 할 수 있습니다." });
    expect(rpcNames()).toEqual([]);
  });
  it("강사뷰로 보는 원장도 원장 몫이 아니다", async () => {
    m.viewer = { ...m.viewer!, teacherId: "teacher" };
    expect(await declineWithdrawalRefund(REPORT_ID, [K0, K1])).toEqual({ error: "환불 결정은 원장만 할 수 있습니다." });
  });
  it("처리가 끝난 보고서엔 정하지 않는다", async () => {
    m.record = { report: { ...baseReport, status: "completed" }, consultations: [] };
    expect(await declineWithdrawalRefund(REPORT_ID, [K0, K1])).toEqual({ error: "처리 전 퇴원보고서에서만 환불 없음을 정할 수 있습니다." });
  });
  it("🔴 화면이 본 줄과 지금 줄이 다르면 거절", async () => {
    expect(await declineWithdrawalRefund(REPORT_ID, [K0])).toEqual({ error: "퇴원월 뒤 청구가 바뀌었습니다. 새로고침 후 다시 확인해 주세요." });
    expect(rpcNames()).toEqual([]);
  });
  it("결정 함수에 지금 줄 전부 + 확인 값 → 처리할 차례면 같은 확인 값으로 이어서 처리 · 감사로그", async () => {
    expect(await declineWithdrawalRefund(REPORT_ID, [K1, K0])).toEqual({ ok: true, processed: true, undecided: 0 });
    expect(argsOf("decide_withdrawal_report_refund")).toMatchObject({ p_actor: "boss", p_report: REPORT_ID, p_none: [K0, K1], p_check: CHECK });
    expect(m.releaseGroup).toHaveBeenCalledWith({ tenantId: "t1", groupId: GROUP_ID, actorId: "boss", check: CHECK });
    expect(m.logAction).toHaveBeenCalledWith(expect.objectContaining({ action: "withdrawal_refund_decline", metadata: expect.objectContaining({ next: "이어서 처리" }) }));
  });
  it("처리할 차례가 아니면(다른 승인·데스크 환불 남음) 처리하지 않는다", async () => {
    m.rpc.mockImplementation(async () => ({ data: { groupId: GROUP_ID, undecided: 0, ready: false }, error: null }));
    expect(await declineWithdrawalRefund(REPORT_ID, [K0, K1])).toEqual({ ok: true, processed: false, undecided: 0 });
    expect(m.releaseGroup).not.toHaveBeenCalled();
  });
  it("🔴 DB가 확인 값을 '모름'(낡음·범위 다름 → null)으로 보류하면 0으로 접지 않는다 — 화면·감사로그가 '처리 확인 대기'(리뷰 r2 m6)", async () => {
    m.rpc.mockImplementation(async () => ({ data: { groupId: GROUP_ID, undecided: null, ready: false }, error: null }));
    expect(await declineWithdrawalRefund(REPORT_ID, [K0, K1])).toEqual({ ok: true, processed: false, undecided: null });
    expect(m.logAction).toHaveBeenCalledWith(expect.objectContaining({ action: "withdrawal_refund_decline", metadata: expect.objectContaining({ next: "처리 확인 대기(확인 값 낡음 — 다음 확인 때 다시 판정)" }) }));
  });
});

describe("원장 '지금 다시 판정'(리뷰 r2 (b)) — cron 안전망과 같은 release 함수 · 새 쓰기 길 아님", () => {
  beforeEach(() => {
    m.viewer = { ...m.viewer!, user: { id: "boss", tenantId: "t1", systemRole: "master", displayName: "원장" } };
    m.record = { report: { ...baseReport, status: "approved" }, consultations: [] };
    m.ready.mockResolvedValue(true);
    m.check.mockReset().mockResolvedValue(CHECK);
    m.releaseGroup.mockReset().mockResolvedValue({ released: 0, blocked: 0, failed: 0 });
    m.holdAfter = { hold: false };
  });
  it("🔴 지금 계산한 확인 값을 그대로 release에 넘긴다 · 다시 읽은 표시를 돌려준다 · 감사로그", async () => {
    expect(await recheckWithdrawalRefund(REPORT_ID)).toEqual({ ok: true, processed: false, hold: false });
    expect(m.check).toHaveBeenCalledWith("t1", GROUP_ID);
    expect(m.releaseGroup).toHaveBeenCalledWith({ tenantId: "t1", groupId: GROUP_ID, actorId: "boss", check: CHECK });
    expect(m.logAction).toHaveBeenCalledWith(expect.objectContaining({ action: "withdrawal_refund_recheck", metadata: expect.objectContaining({ result: "환불 결정 대기 풀림" }) }));
    m.holdAfter = { hold: true };
    expect(await recheckWithdrawalRefund(REPORT_ID)).toEqual({ ok: true, processed: false, hold: true });
    m.releaseGroup.mockResolvedValue({ released: 1, blocked: 0, failed: 0 });
    expect(await recheckWithdrawalRefund(REPORT_ID)).toEqual({ ok: true, processed: true, hold: null });
  });
  it("원장급만 · 강사뷰 아님 · 처리 전 · 묶음 · 관문 SQL 적용 뒤 · 확인 값을 못 만들면 부르지 않는다", async () => {
    m.viewer = { ...m.viewer!, user: { id: "mgr", tenantId: "t1", systemRole: "admin", displayName: "관리자" } };
    expect(await recheckWithdrawalRefund(REPORT_ID)).toEqual({ error: "환불 결정은 원장만 할 수 있습니다." });
    m.viewer = { ...m.viewer!, user: { id: "boss", tenantId: "t1", systemRole: "master", displayName: "원장" }, teacherId: "teacher" };
    expect(await recheckWithdrawalRefund(REPORT_ID)).toEqual({ error: "환불 결정은 원장만 할 수 있습니다." });
    m.viewer = { ...m.viewer!, teacherId: null };
    m.record = { report: { ...baseReport, status: "completed" }, consultations: [] };
    expect(await recheckWithdrawalRefund(REPORT_ID)).toEqual({ error: "처리 전 퇴원보고서에서만 다시 판정할 수 있습니다." });
    m.record = { report: { ...baseReport, status: "approved" }, consultations: [] };
    m.ready.mockResolvedValue(false);
    expect(await recheckWithdrawalRefund(REPORT_ID)).toEqual({ error: "DB 적용 전" });
    m.ready.mockResolvedValue(true);
    m.check.mockRejectedValue(new Error("invoices down"));
    expect(await recheckWithdrawalRefund(REPORT_ID)).toEqual({ error: "환불할 수 있는 청구를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요." });
    expect(m.releaseGroup).not.toHaveBeenCalled();
    m.check.mockResolvedValue(CHECK);
    m.releaseGroup.mockResolvedValue({ released: 0, blocked: 0, failed: 1 });
    expect(await recheckWithdrawalRefund(REPORT_ID)).toEqual({ error: "다시 판정하지 못했습니다. 잠시 후 다시 시도해 주세요." });
  });
});

describe("요청 취소 사유(원장 2026-11-06) — 필수 · 앞뒤 공백 빼고 1~500자 · DB comment · 감사로그", () => {
  beforeEach(() => {
    m.viewer = { ...m.viewer!, user: { id: "req", tenantId: "t1", systemRole: "manager", displayName: "매니저" } };
    m.rpc.mockImplementation(async () => ({ data: { ...baseReport, status: "canceled", revision: 4 }, error: null }));
  });
  it("사유가 없거나 공백뿐이거나 500자를 넘으면 처리 함수를 부르지 않는다", async () => {
    for (const reason of [undefined, "", "   ", "가".repeat(501)]) {
      expect(await changeWithdrawalReport(REPORT_ID, "cancel", 3, { seenStatus: "manager_pending", reason })).toEqual({ error: "취소 사유를 1~500자로 작성해 주세요." });
    }
    expect(rpcNames()).toEqual([]);
  });
  it("앞뒤 공백을 빼고 comment로 넘긴다(500자까지) · 감사로그 metadata에 사유", async () => {
    expect(await changeWithdrawalReport(REPORT_ID, "cancel", 3, { seenStatus: "manager_pending", reason: "  학부모 요청으로 계속 다닙니다  " })).toEqual({ ok: true, id: REPORT_ID });
    expect(argsOf("transition_withdrawal_report")).toMatchObject({ p_action: "cancel", p_payload: { revision: 3, comment: "학부모 요청으로 계속 다닙니다" } });
    expect(m.logAction).toHaveBeenCalledWith(expect.objectContaining({ action: "withdrawal_report_update", metadata: expect.objectContaining({ operation: "요청 취소", cancelReason: "학부모 요청으로 계속 다닙니다" }) }));
    m.calls = [];
    await changeWithdrawalReport(REPORT_ID, "cancel", 3, { seenStatus: "manager_pending", reason: "가".repeat(500) });
    expect((argsOf("transition_withdrawal_report")?.p_payload as { comment: string }).comment).toHaveLength(500);
  });
  it("취소 자격(요청자·원장급)은 사유보다 먼저 본다", async () => {
    m.viewer = { ...m.viewer!, user: { id: "someone", tenantId: "t1", systemRole: "admin", displayName: "관리자" } };
    expect(await changeWithdrawalReport(REPORT_ID, "cancel", 3, { seenStatus: "manager_pending", reason: "x" })).toEqual({ error: "작성 요청을 보낸 사람이나 원장만 취소할 수 있습니다." });
    expect(rpcNames()).toEqual([]);
  });
});
