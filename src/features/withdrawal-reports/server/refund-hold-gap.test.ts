import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_BODY } from "../model";

/**
 * 리뷰 r2 (b) — 상세(getReport)는 목록 표시(DB `refund_hold` 한 벌)와 지금 계산(뒤 청구 → 결정 표)을 함께 읽어 어긋남(`gap`)을 싣는다.
 * 결정 버튼·확인 값은 지금 계산 그대로다(`undecided`). 지금 계산이나 DB 표시를 못 읽었으면 어긋남을 말하지 않는다.
 */
const KEY = "40000000-0000-4000-8000-000000000001#a1";
const m = vi.hoisted(() => ({ later: vi.fn(), decisions: vi.fn(), holdState: vi.fn(), siblings: [] as unknown[] | null, billing: true }));
const report = () => ({
  id: "r1", tenant_id: "t1", student_id: "s1", requested_by: "boss", teacher_id: "tc", manager_id: "mg", director_id: null, manager_ids: ["mg"], director_ids: [],
  manager_decisions: { mg: "2026-11-08" }, director_decisions: {}, exit_kind: "withdrawal", subjects: ["math"], effective_date: "2026-10-31", request_note: "",
  snapshot: { name: "학생", school: null, grade: null, enrolledAt: null, status: "enrolled", withdrawnAt: null, courses: [] }, body: EMPTY_BODY,
  status: "approved", revision: 2, manager_approved_at: null, director_approved_at: null, applied_at: null, last_comment: null,
  created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-08T00:00:00Z", group_id: "g1", group_leader: true, enrollment_ids: ["e1"],
});
vi.mock("@/lib/auth/view-mode", () => ({ effectiveTeacherId: async () => null }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => ({ id: "boss", tenantId: "t1", systemRole: "master", displayName: "원장" }) }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canAccessTenant: async (_role: string, menu: string) => menu !== "billing" || m.billing, canWriteTenant: async () => true }));
vi.mock("@/lib/laboratory/server", () => ({ isLaboratoryMenuAvailable: async () => true }));
vi.mock("@/features/staff/department/server/subject-scope", () => ({ getViewerStaffScope: async () => null }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: async () => ({ operations: { subjects: [] } }) }));
vi.mock("./prefill", () => ({ loadReportPrefill: async () => ({ prefill: {} }) }));
vi.mock("./billing", () => ({ loadReportBilling: async () => ({ tuition: "", arrears: "no", arrearsNote: "" }) }));
vi.mock("./consultations", () => ({ reportConsultations: async () => [] }));
vi.mock("./refund-steps", () => ({ loadRefundSteps: async () => new Map() }));
vi.mock("./refund", () => ({ loadLaterInvoices: m.later, loadDeskStaff: async () => ({ staff: [], designated: true }) }));
vi.mock("./refund-check", () => ({ loadRefundDecisions: m.decisions, loadRefundHoldState: m.holdState, loadRefundOutcomes: async () => new Map(), refundGateReady: async () => true }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      for (const k of ["select", "eq", "in", "is", "lte", "gte", "gt", "neq", "order", "or", "like"]) q[k] = () => q;
      const one = table === "withdrawal_reports" ? report()
        : table === "withdrawal_report_groups" ? { enrollment_ids: ["e1"], teacher_ids: ["tc"], subjects: ["math"] }
        : table === "students" ? { name: "학생", school: null, grade: null, enrolled_at: null, status: "enrolled", withdrawn_at: null, enrollments: [] } : null;
      const many = { data: [], error: null };
      q.maybeSingle = async () => ({ data: one, error: null });
      // 같은 묶음 보고서(상세의 다른 과목 승인 · 결정 보고서 링크) — null이면 조회 실패
      q.limit = async () => table === "withdrawal_reports" ? (m.siblings ? { data: m.siblings, error: null } : { data: null, error: { message: "down" } }) : many;
      q.then = (a: (v: unknown) => unknown) => Promise.resolve(many).then(a);
      return q;
    },
  }),
}));
import { getReport } from "./queries";

const paidLine = { id: "40000000-0000-4000-8000-000000000001", period: "2026-11", category: "tuition", status: "paid", amountBilled: 300000, amountPaid: 300000, partial: false,
  lines: [{ kind: "수업", description: "수학반", amount: 300000, paid: 300000, key: KEY, paidNet: 300000, billingRefund: false, refund: null }] };
const judged = { checkedAt: "2026-11-08T03:00:00Z" };

beforeEach(() => {
  m.siblings = [{ id: "r1", status: "approved", subjects: ["math"], group_leader: true, teacher_id: "tc", requested_by: "boss", manager_id: "mg", director_id: null, manager_ids: ["mg"], director_ids: [] }];
  m.billing = true;
  m.later.mockReset().mockResolvedValue([paidLine]);
  m.decisions.mockReset().mockResolvedValue(new Map());
  m.holdState.mockReset().mockResolvedValue({ hold: false, report: null, undecided: 0, ...judged });
});
const sib = (over: Record<string, unknown>) => ({ id: "r2", status: "approved", subjects: ["english"], group_leader: false, teacher_id: "tc2", requested_by: "boss", manager_id: "mg2", director_id: null, manager_ids: ["mg2"], director_ids: [], ...over });

describe("상세 getReport — 목록 표시(DB)와 지금 계산의 어긋남(리뷰 r2 (b))", () => {
  it("🔴 방향 ① 지금 계산은 결정 전 · DB는 대기 아님 → gap 'app' · 칩용 hold는 DB대로 false · 결정 버튼용 undecided는 지금 계산", async () => {
    const d = (await getReport("r1"))!.refundDecision;
    expect(d).toMatchObject({ hold: false, undecided: [KEY], gap: "app" });
  });
  it("🔴 방향 ② DB는 대기(결정 보고서 = 이 보고서) · 지금 계산은 정할 건 없음 → gap 'db' · hold true", async () => {
    m.holdState.mockResolvedValue({ hold: true, report: "r1", undecided: 1, ...judged });
    m.decisions.mockResolvedValue(new Map([[KEY, { decision: "none", live: false, paidNet: 300000 }]]));
    const d = (await getReport("r1"))!.refundDecision;
    expect(d).toMatchObject({ hold: true, undecided: [], declined: [KEY], gap: "db" });
    // 낸 돈이 없어진 경우(동기화로 환불 기록) — 환불 가능 줄 자체가 없다
    m.decisions.mockResolvedValue(new Map());
    m.later.mockResolvedValue([{ ...paidLine, lines: [{ ...paidLine.lines[0]!, billingRefund: true }] }]);
    expect((await getReport("r1"))!.refundDecision).toMatchObject({ hold: true, undecided: [], gap: "db" });
  });
  it("같으면 없음 — 둘 다 대기 · 둘 다 대기 아님", async () => {
    m.holdState.mockResolvedValue({ hold: true, report: "r1", undecided: 1, ...judged });
    expect((await getReport("r1"))!.refundDecision.gap).toBeNull();
    m.holdState.mockResolvedValue({ hold: false, report: null, undecided: 0, ...judged });
    m.decisions.mockResolvedValue(new Map([[KEY, { decision: "none", live: false, paidNet: 300000 }]]));
    expect((await getReport("r1"))!.refundDecision.gap).toBeNull();
  });
  it("🔴 결정할 줄이 다른 보고서에 있으면 그 보고서(과목 · 열 수 있나)와 DB가 센 건수를 싣는다 — 링크로 바로 간다(막다른 고리 없음 · 리뷰 r2 (b))", async () => {
    m.siblings = [...m.siblings!, sib({})];
    m.holdState.mockResolvedValue({ hold: true, report: "r2", undecided: 2, ...judged });
    m.decisions.mockResolvedValue(new Map([[KEY, { decision: "none", live: false, paidNet: 300000 }]]));
    expect((await getReport("r1"))!.refundDecision).toMatchObject({ hold: true, undecided: [], gap: null, holdCount: 2, holdReport: { id: "r2", subjects: ["english"], readable: true } });
    // 결정 보고서를 모르면(옛 표시) 대표 보고서 — 이 보고서가 대표면 링크 없음(이 보고서다)
    m.holdState.mockResolvedValue({ hold: true, report: null, undecided: 2, ...judged });
    expect((await getReport("r1"))!.refundDecision.holdReport).toBeNull();
    // 대기가 아니면 링크 없음
    m.holdState.mockResolvedValue({ hold: false, report: "r2", undecided: 0, ...judged });
    expect((await getReport("r1"))!.refundDecision.holdReport).toBeNull();
  });
  it("다른 과목 보고서 승인 — 승인 전 형제가 있으면 pending · 다 승인이면 done · 형제 조회 실패면 unknown(목록 상태 칸과 같은 축)", async () => {
    expect((await getReport("r1"))!.refundDecision.others).toBe("done");
    m.siblings = [...m.siblings!, sib({ status: "manager_pending" })];
    expect((await getReport("r1"))!.refundDecision.others).toBe("pending");
    m.siblings = null;
    expect((await getReport("r1"))!.refundDecision.others).toBe("unknown");
  });
  it("🔴 퇴원월 뒤 청구 칸 상태 — 읽음 ok · 조회 실패 failed · 수납 열람권 없음 hidden('없음'이라고 말하지 않게 · 리뷰 r2 I3)", async () => {
    expect((await getReport("r1"))!.refundDecision.laterState).toBe("ok");
    m.later.mockRejectedValue(new Error("청구 조회 실패"));
    expect((await getReport("r1"))!.refundDecision.laterState).toBe("failed");
  });
  it("🔴 지금 계산을 못 하면 말하지 않는다 — 뒤 청구 조회 실패(빈 목록이 '정할 건 없음'으로 읽히지 않게) · 결정 표 조회 실패(빈 결정이 '전부 결정 전'으로 읽히지 않게)", async () => {
    m.holdState.mockResolvedValue({ hold: true, report: "r1", undecided: 1, ...judged });
    m.later.mockRejectedValue(new Error("청구 조회 실패"));
    const failedLater = (await getReport("r1"))!.refundDecision;
    expect(failedLater).toMatchObject({ hold: true, undecided: [], gap: null });
    m.later.mockResolvedValue([paidLine]);
    m.holdState.mockResolvedValue({ hold: false, report: null, undecided: 0, ...judged });
    m.decisions.mockRejectedValue(new Error("결정 표 조회 실패"));
    expect((await getReport("r1"))!.refundDecision).toMatchObject({ hold: false, undecided: [KEY], gap: null });
  });
  it("DB 표시를 못 읽으면(조회 실패 · s2_0036 전) 대기 없음으로 보이고 어긋남은 말하지 않는다", async () => {
    m.holdState.mockRejectedValue(new Error("조회 실패"));
    expect((await getReport("r1"))!.refundDecision).toMatchObject({ hold: false, undecided: [KEY], gap: null });
    m.holdState.mockResolvedValue(null);
    expect((await getReport("r1"))!.refundDecision).toMatchObject({ hold: false, undecided: [KEY], gap: null });
  });
});
