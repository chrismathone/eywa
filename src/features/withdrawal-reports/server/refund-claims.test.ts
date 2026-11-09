import { beforeEach, describe, expect, it, vi } from "vitest";
import { lineIds, refundTag } from "../refund-keys";

/**
 * 줄을 '잡은' 요청서 = 보고서에 이어진 요청서만(검토 2026-11-06 · s2_0036과 함께) — 자료실에서 설명(표식)만 적은 문서로
 * 환불 가능 줄을 숨기면 원장 결정·데스크 환불 없이 처리될 수 있었다. 동시 승인 겹침 확인은 막 만든(10분 안) 요청서도 본다.
 * 🔴 이 묶음에 이어진 요청서만 이 묶음의 줄을 잡는다(팀장 결정 2026-11-06) — 다른 묶음의 요청서는 참고(otherRefund)로만 · 그 줄은 원장 결정 대기.
 */
const T = "t1";
const INV = "40000000-0000-4000-8000-000000000001";
const REPORT = "10000000-0000-4000-8000-000000000001";
const items = [{ kind: "수업", description: "수학 반", amount: 200000, paid: 200000 }, { kind: "기타", description: "차량비", amount: 50000, paid: 50000 }];
const [A, B] = lineIds(items).map((id) => `${INV}#${id}`) as [string, string];
const FORGED = "60000000-0000-4000-8000-00000000000a";
const LINKED = "60000000-0000-4000-8000-00000000000b";
const MINE = "60000000-0000-4000-8000-00000000000c";
const OLD = "10000000-0000-4000-8000-0000000000ff"; // 취소된 옛 요청의 보고서
const m = vi.hoisted(() => ({ docs: [] as unknown[], links: [] as unknown[], reports: [] as unknown[], reportsError: false }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: vi.fn() }));
vi.mock("@/features/owner/server/platform-settings", () => ({ platformAccountIds: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      for (const k of ["select", "eq", "gt", "neq", "order", "like", "or", "in"]) q[k] = () => q;
      const data = table === "invoices" ? [{ id: INV, period: "2026-12", category: "tuition", status: "paid", amount_total: 250000, amount_discount: 0, amount_paid: 250000, line_items: items }]
        : table === "academy_documents" ? m.docs : table === "withdrawal_report_refunds" ? m.links : table === "withdrawal_reports" ? m.reports : [];
      const result = table === "withdrawal_reports" && m.reportsError ? { data: null, error: { message: "boom" } } : { data, error: null };
      q.limit = async () => result;
      q.then = (a: (v: unknown) => unknown) => Promise.resolve(result).then(a);
      return q;
    },
  }),
}));
import { claimedEarlier, loadLaterInvoices } from "./refund";
import { reapprovable, refundableKeys } from "../refund-decision";

const report = { id: REPORT, tenant_id: T, student_id: "s1", effective_date: "2026-11-06", exit_kind: "withdrawal" as const, subjects: ["math"], snapshot: { name: "학생", school: null, grade: null, enrolledAt: null, status: "enrolled", withdrawnAt: null, courses: [] } };
const doc = (id: string, keys: string[], minutesAgo: number, completedDate = "") => ({ id, description: refundTag(REPORT, keys), form_data: { approval: { staff: "데스크" }, result: { completedDate } }, created_at: new Date(Date.now() - minutesAgo * 60_000).toISOString() });

beforeEach(() => { m.docs = []; m.links = []; m.reports = []; m.reportsError = false; });

describe("줄을 잡는 요청서 — 이어진 요청서만", () => {
  it("🔴 표식만 적은(이어지지 않은) 문서는 줄을 잡지 못한다 — 그 줄은 환불 가능으로 남는다", async () => {
    m.docs = [doc(FORGED, [A], 60), doc(LINKED, [B], 60)];
    m.links = [{ document_id: LINKED, report_id: REPORT }];
    m.reports = [{ id: REPORT, status: "approved" }];
    const [inv] = await loadLaterInvoices(report);
    const byKey = new Map(inv!.lines.map((l) => [l.key, l]));
    expect(byKey.get(A)!.refund).toBeNull();
    expect(byKey.get(B)!.refund).toMatchObject({ documentId: LINKED, completed: false });
  });
  it("동시 승인 겹침 확인 — 이어진 요청서 · 10분 안에 만든 요청서는 친다 · 오래된 표식만 적은 문서는 치지 않는다", async () => {
    m.docs = [doc(FORGED, [A], 60), doc(MINE, [A], 0)];
    expect(await claimedEarlier(T, MINE, [A])).toBe(false);
    m.docs = [doc(FORGED, [A], 1), doc(MINE, [A], 0)];
    expect(await claimedEarlier(T, MINE, [A])).toBe(true);
    m.docs = [doc(LINKED, [A], 60), doc(MINE, [A], 0)];
    m.links = [{ document_id: LINKED, report_id: REPORT }];
    expect(await claimedEarlier(T, MINE, [A])).toBe(true);
  });
});

describe("묶음 경계(팀장 결정 2026-11-06) — 이 묶음에 이어진 요청서만 줄을 잡는다", () => {
  const G_NEW = "20000000-0000-4000-8000-0000000000aa";
  const G_OLD = "20000000-0000-4000-8000-0000000000bb";
  const SIBLING = "10000000-0000-4000-8000-0000000000ee"; // 같은 묶음의 다른 과목 보고서
  const inGroup = { ...report, group_id: G_NEW };
  const lineA = async () => (await loadLaterInvoices(inGroup))[0]!.lines.find((l) => l.key === A)!;

  it("🔴 다른 묶음(취소된 요청)의 미완료 요청서 → 줄은 환불 가능(확인 값 · 원장 결정 대기) · 참고 otherRefund · 다시 승인할 수 있다", async () => {
    m.docs = [doc(LINKED, [A], 60)];
    m.links = [{ document_id: LINKED, report_id: OLD, group_id: G_OLD }];
    m.reports = [{ id: OLD, status: "canceled" }];
    const invoices = await loadLaterInvoices(inGroup);
    const line = invoices[0]!.lines.find((l) => l.key === A)!;
    expect(line.refund).toBeNull();
    expect(line.otherRefund).toMatchObject({ documentId: LINKED, completed: false, canceled: true });
    expect(refundableKeys(invoices)).toContain(A);
    expect(reapprovable(line)).toBe(true);
    // 다시 환불을 승인해 새 요청서를 만들면 옛 요청서 때문에 물러나지 않는다
    m.docs = [doc(LINKED, [A], 60), doc(MINE, [A], 0)];
    expect(await claimedEarlier(T, MINE, [A])).toBe(false);
  });

  it("🔴 다른 묶음의 요청서는 환불을 마쳤거나 진행 중이어도 이 묶음의 줄을 잡지 않는다(결정 대기) — 다시 승인은 막는다(같은 돈 두 번)", async () => {
    // 취소된 요청에서 이미 환불을 마친 요청서
    m.docs = [doc(LINKED, [A], 60, "2026-11-06")];
    m.links = [{ document_id: LINKED, report_id: OLD, group_id: G_OLD }];
    m.reports = [{ id: OLD, status: "canceled" }];
    let line = await lineA();
    expect(line.refund).toBeNull();
    expect(line.otherRefund).toMatchObject({ completed: true, canceled: true });
    expect(reapprovable(line)).toBe(false);
    m.docs = [doc(LINKED, [A], 60, "2026-11-06"), doc(MINE, [A], 0)];
    expect(await claimedEarlier(T, MINE, [A])).toBe(true);
    // 끝난(처리 완료) 다른 요청의 환불 전 요청서
    m.docs = [doc(LINKED, [A], 60)];
    m.reports = [{ id: OLD, status: "completed" }];
    line = await lineA();
    expect(line.refund).toBeNull();
    expect(line.otherRefund).toMatchObject({ completed: false, canceled: false });
    expect(reapprovable(line)).toBe(false);
    expect(refundableKeys([{ status: "paid", lines: [line] }])).toEqual([A]);
  });

  it("같은 묶음의 형제 보고서에 이어진 요청서는 잡는다 · 묶음을 모르고 부르면 이 보고서에 이어진 것만", async () => {
    m.docs = [doc(LINKED, [A], 60)];
    m.links = [{ document_id: LINKED, report_id: SIBLING, group_id: G_NEW }];
    m.reports = [{ id: SIBLING, status: "approved" }];
    const line = await lineA();
    expect(line.refund).toMatchObject({ documentId: LINKED });
    expect(line.otherRefund).toBeUndefined();
    // 묶음 id 없이(옛 호출) — 형제에 이어진 요청서는 잡지 않는다(결정 대기 쪽)
    expect((await loadLaterInvoices(report))[0]!.lines.find((l) => l.key === A)!.refund).toBeNull();
  });
  it("보고서 상태를 못 읽으면 던진다(확인 값을 만들지 못하면 처리하지 않는다)", async () => {
    m.docs = [doc(LINKED, [A], 60)];
    m.links = [{ document_id: LINKED, report_id: OLD }];
    m.reportsError = true;
    await expect(loadLaterInvoices(report)).rejects.toThrow(/보고서 상태 조회 실패/);
  });
});
