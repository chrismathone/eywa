import { beforeEach, describe, expect, it, vi } from "vitest";
import { lineIds, refundTag } from "../refund-keys";

/**
 * 미배분 납부(줄별 납부 기록 없음)의 몫과 무효 청구(리뷰 r2 I5·D-10·(c) · 원장 2026-11-09).
 * - 과목 수강종료 = 미배분 × (끝내는 과목 줄 청구액 ÷ 청구 전체 줄 청구액), 내림(환불이 적어지는 쪽) · 키 `청구#unalloc:<과목>` · 분모 0 → 금액 모름(낸 돈 전부로 · 결정 대상).
 * - 전체 퇴원 = 다른 묶음이 잡거나 정한 과목 몫을 뺀 나머지 `청구#unalloc:~<과목>`.
 * - 낸 돈 있는 무효 청구는 관문에(같은 달 재발행이면 표시) · 낸 돈 없는 무효 청구는 뺀다.
 * - 이 묶음 요청서가 담은 미배분 키는, 미배분이 아직 남아 있으면 실제 줄을 잡지 않고 · 미배분이 0이 됐으면(줄에 배분) 실제 줄을 정확하지 않게 잡는다(D-2).
 */
const T = "t1";
const G = "20000000-0000-4000-8000-000000000001";
const G_OTHER = "20000000-0000-4000-8000-000000000002";
const INV = "40000000-0000-4000-8000-000000000001";
const REPORT = "10000000-0000-4000-8000-000000000001";
const DOC = "60000000-0000-4000-8000-00000000000a";
const m = vi.hoisted(() => ({ invoices: [] as unknown[], docs: [] as unknown[], links: [] as unknown[], reports: [] as unknown[], decisions: [] as unknown[], groups: [] as unknown[] }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: vi.fn() }));
vi.mock("@/features/owner/server/platform-settings", () => ({ platformAccountIds: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      for (const k of ["select", "eq", "gt", "neq", "order", "like", "or", "in"]) q[k] = () => q;
      const data = table === "invoices" ? m.invoices
        : table === "classes" ? [{ id: "c-math", class_name: "수학반", subject: "math" }, { id: "c-eng", class_name: "영어반", subject: "english" }]
        : table === "academy_documents" ? m.docs : table === "withdrawal_report_refunds" ? m.links : table === "withdrawal_reports" ? m.reports
        : table === "withdrawal_report_refund_decisions" ? m.decisions : table === "withdrawal_report_groups" ? m.groups : [];
      const result = { data, error: null };
      q.limit = async () => result;
      q.then = (a: (v: unknown) => unknown) => Promise.resolve(result).then(a);
      return q;
    },
  }),
}));
import { laterInvoicesFor } from "./refund";

const course = (id: string, classId: string, className: string, subject: string) => ({ id, classId, className, subject, teacherId: "ta", teacherName: "가강사", startDate: "2026-03-01", endDate: null, onHold: false });
const snapshot = { name: "학생", school: null, grade: null, enrolledAt: null, status: "enrolled", withdrawnAt: null, courses: [course("e1", "c-math", "수학반", "math"), course("e2", "c-eng", "영어반", "english")] };
const report = (over: Record<string, unknown> = {}) => ({ id: REPORT, tenant_id: T, student_id: "s1", effective_date: "2026-11-20", exit_kind: "subject_end" as const, subjects: ["math"], group_id: G, snapshot, ...over }) as never;
const invoice = (over: Record<string, unknown> = {}) => ({ id: INV, period: "2026-12", category: "tuition", status: "partial", amount_total: 400000, amount_discount: 0, amount_paid: 300000,
  line_items: [{ kind: "수업", description: "수학반", amount: 200000 }, { kind: "수업", description: "영어반", amount: 200000 }], ...over });
const unallocOf = async (r = report()) => (await laterInvoicesFor(r)).flatMap((i) => i.lines).filter((l) => l.unallocated);

beforeEach(() => { m.invoices = [invoice()]; m.docs = []; m.links = []; m.reports = []; m.decisions = []; m.groups = []; });

describe("미배분 납부의 몫(리뷰 r2 I5·D-10)", () => {
  it("🔴 과목 수강종료 = 끝내는 과목 비율 · 내림 · 청구 전체 미배분은 참고로", async () => {
    m.invoices = [invoice({ amount_total: 300001, amount_paid: 100000, line_items: [{ kind: "수업", description: "수학반", amount: 100001 }, { kind: "수업", description: "영어반", amount: 200000 }] })];
    const [u, ...rest] = await unallocOf();
    expect(rest).toEqual([]);
    // 100,000 × 100,001 ÷ 300,001 = 33,333.6… → 33,333(올리면 환불이 많아지는 쪽)
    expect(u).toMatchObject({ key: `${INV}#unalloc:math`, amount: 33333, paidNet: 33333, unallocTotal: 100000, unallocScope: "math" });
    expect(u!.amountUnknown).toBeUndefined();
  });
  it("🔴 분모 0(줄 청구액을 모름) → 금액 모름 · 낸 돈 전부로 결정 대상(0원으로 두면 확인 값에서 빠져 결정 없이 처리된다)", async () => {
    m.invoices = [invoice({ amount_total: 0, amount_paid: 50000, line_items: [{ kind: "수업", description: "수학반", amount: 0 }, { kind: "수업", description: "영어반", amount: 0 }] })];
    const [u] = await unallocOf();
    expect(u).toMatchObject({ key: `${INV}#unalloc:math`, amount: 50000, paidNet: 50000, amountUnknown: true });
  });
  it("🔴 전체 퇴원 = 다른 묶음(취소 안 됨)이 정한 과목 몫을 뺀 나머지 · 취소된 묶음의 결정은 빼지 않는다", async () => {
    m.decisions = [{ line_key: `${INV}#unalloc:math`, group_id: G_OTHER }];
    m.groups = [{ id: G_OTHER, status: "pending" }];
    const [u] = await unallocOf(report({ exit_kind: "withdrawal", subjects: ["math", "english"] }));
    expect(u).toMatchObject({ key: `${INV}#unalloc:~math`, amount: 150000, paidNet: 150000, unallocScope: "~math" });
    m.groups = [{ id: G_OTHER, status: "canceled" }];
    const [whole] = await unallocOf(report({ exit_kind: "withdrawal", subjects: ["math", "english"] }));
    expect(whole).toMatchObject({ key: `${INV}#unalloc`, amount: 300000 });
  });
});

describe("무효(void) 청구(리뷰 r2 (c))", () => {
  it("🔴 낸 돈 있는 무효 청구는 넣는다(같은 달 재발행이면 표시) · 낸 돈 없는 무효 청구는 뺀다", async () => {
    m.invoices = [
      invoice({ status: "void", amount_total: 735750, amount_discount: 10000, amount_paid: 725750 }),
      invoice({ id: "40000000-0000-4000-8000-000000000002", status: "unpaid", amount_paid: 0 }),
      invoice({ id: "40000000-0000-4000-8000-000000000003", period: "2027-01", status: "void", amount_paid: 0 }),
    ];
    const later = await laterInvoicesFor(report({ exit_kind: "withdrawal", subjects: ["math", "english"] }));
    expect(later.map((i) => i.id)).not.toContain("40000000-0000-4000-8000-000000000003");
    const v = later.find((i) => i.id === INV)!;
    expect(v).toMatchObject({ status: "void", reissued: true });
    expect(v.lines.filter((l) => l.unallocated)).toMatchObject([{ key: `${INV}#unalloc`, paidNet: 725750 }]);
    m.invoices = [invoice({ status: "void", amount_total: 735750, amount_discount: 10000, amount_paid: 725750 })];
    expect((await laterInvoicesFor(report({ exit_kind: "withdrawal", subjects: ["math", "english"] })))[0]!.reissued).toBeUndefined();
  });
});

describe("이 묶음 요청서가 담은 미배분 키(리뷰 r2 D-2)", () => {
  const own = (keys: string[]) => {
    m.docs = [{ id: DOC, description: refundTag(REPORT, keys), form_data: { approval: { staff: "데스크" }, result: { completedDate: "" } }, created_at: "2026-11-01T00:00:00Z" }];
    m.links = [{ document_id: DOC, report_id: REPORT, group_id: G }];
    m.reports = [{ id: REPORT, status: "approved" }];
  };
  it("미배분이 남아 있으면 다른 과목 몫 키는 실제 줄·이 과목 몫을 잡지 않는다", async () => {
    own([`${INV}#unalloc:english`]);
    const later = await laterInvoicesFor(report());
    expect(later.flatMap((i) => i.lines).map((l) => [l.key.replace(INV, ""), l.refund?.documentId ?? null])).toEqual([["#" + lineIds([{ kind: "수업", description: "수학반", amount: 200000 }])[0], null], ["#unalloc:math", null]]);
  });
  it("🔴 미배분이 0이 됐으면(줄에 배분) 실제 줄을 잡은 것으로 · 정확하지 않음(원장이 다시 정한다)", async () => {
    own([`${INV}#unalloc`]);
    m.invoices = [invoice({ status: "paid", amount_paid: 400000, line_items: [{ kind: "수업", description: "수학반", amount: 200000, paid: 200000 }, { kind: "수업", description: "영어반", amount: 200000, paid: 200000 }] })];
    const later = await laterInvoicesFor(report({ exit_kind: "withdrawal", subjects: ["math", "english"] }));
    const lines = later.flatMap((i) => i.lines);
    expect(lines.some((l) => l.unallocated)).toBe(false);
    expect(lines.map((l) => l.refund)).toEqual([{ documentId: DOC, deskName: "데스크", completed: false, exact: false }, { documentId: DOC, deskName: "데스크", completed: false, exact: false }]);
  });
});
