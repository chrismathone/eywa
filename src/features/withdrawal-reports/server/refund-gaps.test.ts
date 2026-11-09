import { beforeEach, describe, expect, it, vi } from "vitest";
import { lineIds } from "../refund-keys";

/**
 * 리뷰 수리(2026-11-06 r1 · 차단 1·2 · 중요 6) — 낸 돈이 있는 퇴원월 뒤 청구 줄이 환불 확인 값에서 빠지면 DB는 '결정 안 된 줄 0'으로 보고
 * 원장 결정 없이 처리한다(위험한 쪽). 리뷰어 모의(①~⑤)를 고친 뒤 기대값으로 옮겼다 — 빠지지 않아야 한다.
 */
const T = "t1";
const G = "20000000-0000-4000-8000-000000000001";
const INV = "40000000-0000-4000-8000-000000000001";
const course = (id: string, classId: string, className: string, subject: string, startDate = "2026-03-01") =>
  ({ id, classId, className, subject, teacherId: "ta", teacherName: "가강사", startDate, endDate: null, onHold: false });

const m = vi.hoisted(() => ({
  reports: [] as unknown[], invoices: [] as unknown[], enrollments: [] as unknown[], groupSubjects: [] as string[], groupKind: "withdrawal",
}));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: vi.fn() }));
vi.mock("@/features/owner/server/platform-settings", () => ({ platformAccountIds: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    // 퇴원월 뒤 청구 내용 지문(리뷰 r2 D-12 — loadGroupRefundCheck의 asOf)
    rpc: async (name: string) => (name === "withdrawal_refund_later_fingerprint" ? { data: "fp-test", error: null } : { data: null, error: { message: `모의에 없는 rpc ${name}` } }),
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      for (const k of ["select", "eq", "gt", "neq", "order", "like", "or", "in"]) q[k] = () => q;
      const data = table === "invoices" ? m.invoices
        : table === "enrollments" ? m.enrollments
        : table === "classes" ? [{ id: "c-math", class_name: "수학반", subject: "math" }, { id: "c-eng", class_name: "영어반", subject: "english" }]
        : table === "withdrawal_reports" ? m.reports : [];
      const result = { data, error: null };
      q.limit = async () => result;
      q.then = (a: (v: unknown) => unknown) => Promise.resolve(result).then(a);
      q.maybeSingle = async () => ({ data: { subjects: m.groupSubjects, exit_kind: m.groupKind, enrollment_ids: ["e1"], effective_date: "2026-11-20" }, error: null });
      return q;
    },
  }),
}));
import { loadLaterInvoices } from "./refund";
import { loadGroupRefundCheck } from "./refund-check";
import { refundableKeys } from "../refund-decision";

const snapshot = (courses: unknown[]) => ({ name: "학생", school: null, grade: null, enrolledAt: null, status: "enrolled", withdrawnAt: null, courses });
const inv = (period: string, status: string, paid: number, items: unknown[]) =>
  ({ id: INV, period, category: "tuition", status, amount_total: 300000, amount_discount: 0, amount_paid: paid, line_items: items });
const leader = (over: Record<string, unknown> = {}) =>
  ({ id: "ra", tenant_id: T, student_id: "s1", effective_date: "2026-11-20", exit_kind: "withdrawal", subjects: ["math"], snapshot: snapshot([course("e1", "c-math", "수학반", "math")]), group_leader: true, group_id: G, ...over });

beforeEach(() => { m.reports = []; m.invoices = []; m.enrollments = []; m.groupSubjects = []; m.groupKind = "withdrawal"; });

describe("확인 값이 낸 돈을 빠뜨리지 않는다(리뷰 r1)", () => {
  it("🔴 ① 이 묶음이 끝낼 미래 시작 수강(스냅숏)과 0일 수강은 재등록이 아니다 — 그 달 청구가 확인 값에 남는다", async () => {
    const snap = snapshot([course("e1", "c-math", "수학반", "math"), course("e2", "c-eng", "영어반", "english", "2026-12-01")]);
    m.reports = [leader({ subjects: ["math", "english"], snapshot: snap })];
    m.enrollments = [
      { id: "e2", start_date: "2026-12-01", end_date: null, classes: { subject: "english" } },            // 스냅숏의 미래 시작 수강 — 이번 퇴원으로 함께 닫힌다
      { id: "e7", start_date: "2026-12-01", end_date: "2026-12-01", classes: { subject: "english" } },    // 처리 뒤 생긴 0일 수강
    ];
    m.invoices = [inv("2026-12", "paid", 300000, [{ kind: "수업", description: "영어반", amount: 300000, paid: 300000 }])];
    const check = await loadGroupRefundCheck(T, G);
    expect(check.refundable).toHaveLength(1);
    expect(check.refundable[0]).toMatchObject({ report: "ra", paid: 300000 });
    // 진짜 재등록(스냅숏 밖 · 0일 아님)이면 그 달부터는 새로 다니는 청구 — 종전대로 뺀다
    m.enrollments = [{ id: "e8", start_date: "2026-12-01", end_date: null, classes: { subject: "english" } }];
    expect((await loadGroupRefundCheck(T, G)).refundable).toEqual([]);
  });

  it("🔴 ② 부분 납부 여러 줄 청구에 줄별 납부액이 없으면 그 돈을 '미배분 납부' 줄로 — 확인 값 · 원장 화면에 보이고 고를 수 있다", async () => {
    m.reports = [leader()];
    m.invoices = [inv("2026-12", "partial", 200000, [{ kind: "수업", description: "수학반", amount: 200000 }, { kind: "교재", description: "교재", amount: 100000 }])];
    const later = await loadLaterInvoices(m.reports[0] as never, { orphans: [] });
    const extra = later[0]!.lines.find((l) => l.unallocated)!;
    expect(extra).toMatchObject({ key: `${INV}#unalloc`, paidNet: 200000, description: "미배분 납부(줄별 납부 기록 없음)", billingRefund: false, refund: null });
    expect(refundableKeys(later)).toEqual([`${INV}#unalloc`]);
    expect((await loadGroupRefundCheck(T, G)).refundable).toEqual([{ key: `${INV}#unalloc`, report: "ra", paid: 200000 }]);
    // 줄에 다 나뉘면(완납 · 줄별 납부액 있음) 미배분 줄은 없다
    m.invoices = [inv("2026-12", "paid", 300000, [{ kind: "수업", description: "수학반", amount: 200000, paid: 200000 }, { kind: "교재", description: "교재", amount: 100000, paid: 100000 }])];
    expect((await loadLaterInvoices(m.reports[0] as never, { orphans: [] }))[0]!.lines.some((l) => l.unallocated)).toBe(false);
  });

  it("🔴 ⑥ makeedu 부분 환불이 있는 줄은 남은 낸 돈만큼 확인 값에 · 전체 환불이면 뺀다 · 금액을 모르면 낸 돈 전부(닫히는 쪽)", async () => {
    m.reports = [leader()];
    const item = (refunds: unknown[]) => [{ kind: "수업", description: "수학반", amount: 300000, paid: 300000, refunds }];
    m.invoices = [inv("2026-12", "paid", 300000, item([{ status: "active", type: "partial", amount: 50000 }, { status: "cancelled", type: "partial", amount: 99999 }]))];
    let line = (await loadLaterInvoices(m.reports[0] as never, { orphans: [] }))[0]!.lines[0]!;
    expect(line).toMatchObject({ billingRefund: false, paidNet: 250000, billingRefundAmount: 50000 });
    expect((await loadGroupRefundCheck(T, G)).refundable).toEqual([{ key: line.key, report: "ra", paid: 250000 }]);
    m.invoices = [inv("2026-12", "paid", 300000, item([{ status: "active", type: "full", amount: 300000 }]))];
    line = (await loadLaterInvoices(m.reports[0] as never, { orphans: [] }))[0]!.lines[0]!;
    expect(line.billingRefund).toBe(true);
    expect((await loadGroupRefundCheck(T, G)).refundable).toEqual([]);
    m.invoices = [inv("2026-12", "paid", 300000, item([{ status: "active", type: "partial" }]))];
    line = (await loadLaterInvoices(m.reports[0] as never, { orphans: [] }))[0]!.lines[0]!;
    expect(line).toMatchObject({ billingRefund: false, paidNet: 300000, billingRefundAmount: null });
  });

  it("④ 전체 퇴원 · 보고서 둘 — 확인 값은 대표 보고서 몫 · 다른 보고서 화면도 같은 줄(그 화면의 '환불 없음'·일부 환불 승인은 DB가 받는다 — 리뷰 #4 · PGlite ㉑)", async () => {
    const snap = snapshot([course("e1", "c-math", "수학반", "math"), course("e2", "c-eng", "영어반", "english")]);
    const base = { tenant_id: T, student_id: "s1", effective_date: "2026-11-20", exit_kind: "withdrawal", snapshot: snap, group_id: G };
    m.reports = [{ ...base, id: "ra", subjects: ["math"], group_leader: true }, { ...base, id: "rb", subjects: ["english"], group_leader: false }];
    const items = [{ kind: "수업", description: "수학반", amount: 150000, paid: 150000 }, { kind: "수업", description: "영어반", amount: 150000, paid: 150000 }];
    m.invoices = [inv("2026-12", "paid", 300000, items)];
    const keys = lineIds(items).map((id) => `${INV}#${id}`);
    expect((await loadGroupRefundCheck(T, G)).refundable).toEqual(keys.map((key) => ({ key, report: "ra", paid: 150000 })));
    expect(refundableKeys(await loadLaterInvoices(m.reports[1] as never))).toEqual(keys);
  });

  it("⑤ 과목 수강종료 · 보고서 둘 — 반에 안 묶인 기타 항목(차량비)은 두 화면에 보이고 확인 값엔 한 번(대표 보고서 몫)", async () => {
    const snap = snapshot([course("e1", "c-math", "수학반", "math"), course("e2", "c-eng", "영어반", "english"), course("e9", "c-kor", "국어반", "korean")]);
    const base = { tenant_id: T, student_id: "s1", effective_date: "2026-11-20", exit_kind: "subject_end", snapshot: snap, group_id: G };
    m.reports = [{ ...base, id: "ra", subjects: ["math"], group_leader: true }, { ...base, id: "rb", subjects: ["english"], group_leader: false }];
    m.groupSubjects = ["english", "math"]; m.groupKind = "subject_end";
    // 계속 다니는 국어 반(묶음 종료 대상 밖) — 처리 범위는 과목 수강종료 그대로
    m.enrollments = [{ id: "e9", start_date: "2026-03-01", end_date: null, classes: { subject: "korean", is_active: true, closed_at: null, tenant_id: T } }];
    const items = [{ kind: "수업", description: "수학반", amount: 100000, paid: 100000 }, { kind: "수업", description: "영어반", amount: 100000, paid: 100000 }, { kind: "차량비", description: "차량비", amount: 50000, paid: 50000 }];
    m.invoices = [inv("2026-12", "paid", 250000, items)];
    const [MATH, ENG, BUS] = lineIds(items).map((id) => `${INV}#${id}`) as [string, string, string];
    const check = await loadGroupRefundCheck(T, G);
    expect(check.scope).toBe("subject_end");
    expect(check.refundable).toEqual(expect.arrayContaining([{ key: MATH, report: "ra", paid: 100000 }, { key: BUS, report: "ra", paid: 50000 }, { key: ENG, report: "rb", paid: 100000 }]));
    expect(check.refundable.filter((r) => r.key === BUS)).toHaveLength(1);
    expect(refundableKeys(await loadLaterInvoices(m.reports[1] as never)).sort()).toEqual([ENG, BUS].sort());
  });

  it("청구가 상한(120건)에 닿으면 잘렸을 수 있어 확인 값을 만들지 않는다(던짐 — 처리하지 않는 쪽)", async () => {
    m.reports = [leader()];
    m.invoices = Array.from({ length: 120 }, (_, i) => ({ ...inv(`2027-${String(i).padStart(2, "0")}`, "paid", 0, []), id: `40000000-0000-4000-8000-${String(i).padStart(12, "0")}` }));
    await expect(loadGroupRefundCheck(T, G)).rejects.toThrow(/너무 많아/);
  });
});
