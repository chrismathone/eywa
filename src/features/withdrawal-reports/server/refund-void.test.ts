import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 리뷰 r2 (c) · 결정 2026-11-09 — **낸 돈이 있는 무효(void) 청구는 관문에 넣는다**(퇴원월 뒤 청구에 한함). 빼면 그 돈을 원장이 못 보고 결정 없이 처리된다.
 * 낸 돈이 없는 무효 청구는 종전대로 뺀다. 납부액을 못 읽으면 확인 값을 만들지 않는다(처리하지 않는 쪽).
 * DB(s2_0037 note)는 청구를 따로 거르지 않고 이 확인 값을 믿는다(asOf만 void 포함으로 같은 범위를 읽는다) — 앱 한 곳(`laterInvoicesFor`)이 기준이다.
 * 이 모의는 청구 조회의 거르기(eq · neq · gt)를 실제로 적용한다 — 무효 청구를 조회에서 다시 빼면 이 시험이 잡는다.
 */
const T = "t1";
const G = "20000000-0000-4000-8000-000000000001";
const JUNE = "40000000-0000-4000-8000-000000000001";
const JULY = "40000000-0000-4000-8000-000000000002";
const m = vi.hoisted(() => ({
  reports: [] as unknown[], invoices: [] as Record<string, unknown>[],
  group: {} as Record<string, unknown> | null, groupError: null as null | { code?: string; message: string },
}));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: vi.fn() }));
vi.mock("@/features/owner/server/platform-settings", () => ({ platformAccountIds: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    // 퇴원월 뒤 청구 내용 지문(리뷰 r2 D-12 — loadGroupRefundCheck의 asOf)
    rpc: async (name: string) => (name === "withdrawal_refund_later_fingerprint" ? { data: "fp-test", error: null } : { data: null, error: { message: `모의에 없는 rpc ${name}` } }),
    from: (table: string) => {
      const keep: ((r: Record<string, unknown>) => boolean)[] = [];
      const q: Record<string, unknown> = {};
      for (const k of ["select", "order", "like", "or", "in"]) q[k] = () => q;
      // 청구 행에 없는 칸(tenant_id · student_id)은 거르지 않는다 — 이 학생의 청구만 싣는다.
      q.eq = (c: string, v: unknown) => { keep.push((r) => !(c in r) || String(r[c]) === String(v)); return q; };
      q.neq = (c: string, v: unknown) => { keep.push((r) => String(r[c]) !== String(v)); return q; };
      q.gt = (c: string, v: unknown) => { keep.push((r) => !(c in r) || String(r[c]) > String(v)); return q; };
      const rows = () => (table === "invoices" ? m.invoices.filter((r) => keep.every((f) => f(r))) : table === "withdrawal_reports" ? m.reports : []);
      q.limit = async () => ({ data: rows(), error: null });
      q.then = (a: (v: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(a);
      q.maybeSingle = async () => (table === "withdrawal_report_groups" ? { data: m.groupError ? null : m.group, error: m.groupError } : { data: null, error: null });
      return q;
    },
  }),
}));
import { loadLaterInvoices } from "./refund";
import { loadGroupRefundCheck, loadRefundHoldState } from "./refund-check";
import { refundableKeys } from "../refund-decision";

const snapshot = { name: "학생", school: null, grade: null, enrolledAt: null, status: "enrolled", withdrawnAt: null, courses: [] };
// 퇴원월 2026-05 · 전체 퇴원(운영 1건의 모양 — 그 학생은 지금 퇴원보고서 묶음이 없다 · 2026-11-09 읽기 전용 확인).
const leader = { id: "ra", tenant_id: T, student_id: "s1", effective_date: "2026-05-29", exit_kind: "withdrawal", subjects: ["math"], snapshot, group_leader: true, group_id: G };
// 운영 1건의 모양(값만 · 이름 없음): 2026-06 수업 청구 · 무효 · 수업 줄 셋(줄별 납부 기록 없음) · 청구 735,750 · 할인 10,000 · 낸 돈 725,750.
const juneVoid = { id: JUNE, period: "2026-06", category: "tuition", status: "void", amount_total: 735750, amount_discount: 10000, amount_paid: 725750, updated_at: "2026-07-31T09:02:23Z",
  line_items: [{ kind: "수업", description: "가반", amount: 327000 }, { kind: "수업", description: "나반", amount: 81750 }, { kind: "수업", description: "다반", amount: 327000 }] };
// 같은 학생의 2026-07 무효 청구 — 낸 돈 0(돌려줄 돈이 없다 → 종전대로 뺀다).
const julyVoid = { id: JULY, period: "2026-07", category: "tuition", status: "void", amount_total: 163500, amount_discount: 0, amount_paid: 0, updated_at: "2026-07-31T09:02:23Z",
  line_items: [{ kind: "수업", description: "가반", amount: 163500 }] };

beforeEach(() => { m.reports = [leader]; m.invoices = []; m.group = {}; m.groupError = null; });

describe("낸 돈이 있는 무효(void) 청구는 관문에 든다(리뷰 r2 (c))", () => {
  it("🔴 운영 모양 — 무효 청구의 낸 돈 725,750원이 '미배분 납부' 줄로 결정 대상 · 확인 값에 든다 · 낸 돈 없는 무효 청구는 빠진다", async () => {
    m.invoices = [juneVoid, julyVoid];
    const later = await loadLaterInvoices(leader as never, { orphans: [] });
    expect(later.map((i) => [i.period, i.status, i.amountBilled, i.amountPaid])).toEqual([["2026-06", "void", 725750, 725750]]);
    expect(later[0]!.lines.map((l) => [l.description, l.paidNet])).toEqual([["가반", 0], ["나반", 0], ["다반", 0], ["미배분 납부(줄별 납부 기록 없음)", 725750]]);
    expect(refundableKeys(later)).toEqual([`${JUNE}#unalloc`]);
    const check = await loadGroupRefundCheck(T, G);
    expect(check.refundable).toEqual([{ key: `${JUNE}#unalloc`, report: "ra", paid: 725750 }]);
    expect(check.scope).toBe("withdrawal");
  });
  it("줄별 납부 기록이 있는 무효 청구 — 그 줄들이 그대로 결정 대상", async () => {
    m.invoices = [{ ...juneVoid, amount_total: 300000, amount_discount: 0, amount_paid: 300000,
      line_items: [{ kind: "수업", description: "가반", amount: 200000, paid: 200000 }, { kind: "교재", description: "교재", amount: 100000, paid: 100000 }] }];
    const later = await loadLaterInvoices(leader as never, { orphans: [] });
    expect(later[0]!.lines.map((l) => [l.description, l.paidNet, !!l.unallocated])).toEqual([["가반", 200000, false], ["교재", 100000, false]]);
    expect((await loadGroupRefundCheck(T, G)).refundable.map((r) => r.paid)).toEqual([200000, 100000]);
  });
  it("낸 돈이 없는 무효 청구만 있으면 뒤 청구도 확인 값도 비어 있다(종전대로)", async () => {
    m.invoices = [julyVoid, { ...julyVoid, id: "40000000-0000-4000-8000-000000000003", amount_paid: null }];
    expect(await loadLaterInvoices(leader as never, { orphans: [] })).toEqual([]);
    expect((await loadGroupRefundCheck(T, G)).refundable).toEqual([]);
  });
  it("🔴 무효 청구의 납부액을 못 읽으면 확인 값을 만들지 않는다(모르면 처리하지 않는 쪽 · 빼고 지나가지 않는다)", async () => {
    m.invoices = [{ ...juneVoid, amount_paid: "읽을 수 없음" }];
    await expect(loadGroupRefundCheck(T, G)).rejects.toThrow("청구 납부액을 읽지 못했습니다.");
  });
  it("무효가 아닌 청구와 같은 규칙 — 퇴원월 이하 무효 청구는 관문 밖(퇴원월 뒤만)", async () => {
    m.invoices = [{ ...juneVoid, period: "2026-05" }];
    expect(await loadLaterInvoices(leader as never, { orphans: [] })).toEqual([]);
  });
});

describe("상세용 DB 표시 한 벌 loadRefundHoldState(리뷰 r2 (b))", () => {
  it("대기 · 결정 보고서 · 마지막 판정 시각을 그대로 · 칸이 없는 DB(s2_0037 전)·묶음 없음은 모름(null) · 그 밖 오류는 던진다", async () => {
    m.group = { refund_hold: true, refund_hold_report: "ra", refund_undecided: ["k1", "k2"], refund_checked_at: "2026-11-08T03:00:00+00:00" };
    expect(await loadRefundHoldState(T, G)).toEqual({ hold: true, report: "ra", undecided: 2, checkedAt: "2026-11-08T03:00:00+00:00" });
    m.group = { refund_hold: false, refund_hold_report: null, refund_undecided: [], refund_checked_at: null };
    expect(await loadRefundHoldState(T, G)).toEqual({ hold: false, report: null, undecided: 0, checkedAt: null });
    m.group = null;
    expect(await loadRefundHoldState(T, G)).toBeNull();
    m.groupError = { code: "42703", message: "column withdrawal_report_groups.refund_hold does not exist" };
    expect(await loadRefundHoldState(T, G)).toBeNull();
    m.groupError = { code: "57014", message: "timeout" };
    await expect(loadRefundHoldState(T, G)).rejects.toThrow("환불 결정 대기 조회 실패");
  });
});
