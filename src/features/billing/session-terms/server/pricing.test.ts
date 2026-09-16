import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveSettings } from "@/features/owner/resolve";
import { getSessionTermsView } from "./queries";
import { confirmClassTerms, confirmSessionTerm, unconfirmSessionTerm, refreshPlannedTerms } from "./actions";
import { revalidatePath } from "next/cache";
import { logAction } from "@/features/audit/server/log";
import { getSessionVerificationView } from "./verification-queries";
import { saveTeacherSplits } from "./splits-actions";
import { getTeacherSettlementView } from "@/features/payroll/server/settlement-queries";
import { updateMonthlyTermSessions } from "./monthly-sessions";

const h = vi.hoisted(() => {
  const state = {
    tables: {} as Record<string, Record<string, unknown>[]>,
    billing: {} as Record<string, unknown>,
    writes: [] as { table: string; patch: Record<string, unknown> }[],
    after: [] as (() => Promise<void>)[],
  };
  const client = {
    rpc: () => ({ range: () => Promise.resolve({ data: [], error: null }) }),
    from(table: string) {
      let single = false;
      let patch: Record<string, unknown> | undefined;
      let upserts: Record<string, unknown>[] | undefined;
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "neq", "in", "order", "range", "gte", "lte", "or", "not"]) builder[method] = () => builder;
      builder.maybeSingle = () => { single = true; return builder; };
      builder.update = (value: Record<string, unknown>) => { patch = value; return builder; };
      builder.upsert = (values: Record<string, unknown>[]) => { upserts = values; return builder; };
      builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
        if (patch) {
          state.writes.push({ table, patch });
          state.tables[table] = (state.tables[table] ?? []).map((row) => ({ ...row, ...patch }));
        }
        if (upserts) {
          state.tables[table] = upserts;
          state.writes.push(...upserts.map((row) => ({ table, patch: row })));
        }
        const rows = state.tables[table] ?? [];
        return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null }).then(resolve, reject);
      };
      return builder;
    },
  };
  return { state, client };
});

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => h.client }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: async () => resolveSettings({ billing: h.state.billing }, { name: "학원" }) }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => ({ id: "owner", tenantId: "tenant", systemRole: "master" }) }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canWriteTenant: async () => true }));
vi.mock("@/features/audit/server/log", () => ({ logAction: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: (fn: () => Promise<void>) => h.state.after.push(fn) }));

beforeEach(() => {
  vi.clearAllMocks();
  h.state.after = [];
  h.state.billing = {};
  h.state.writes = [];
  h.state.tables = {
    invoices: [{ id: "invoice", student_id: "student", line_items: [] }],
    students: [{ id: "student", name: "학생", grade: "중1" }],
    classes: [{ id: "class", subject: "english", english_track: "injaewon" }],
    invoice_session_terms: [{ id: "term", invoice_id: "invoice", class_id: "class", subject: "english", planned_sessions: 9, confirmed_sessions: 8, unit_price: 40875, amount: 327000, confirmed_at: "2026-09-01", note: null, class: { class_name: "영어반", english_track: "injaewon" } }],
  };
});

describe("설정 → 회차 화면 조회·확정", () => {
  it("전체환불은 기존 확정값을 보존하면서 배분·분배의 기준액을 0으로 읽는다", async () => {
    const source = { kind: "수업", description: "영어반", amount: 312000, discount: 10000, paid: 302000 };
    h.state.tables.invoices[0].line_items = [{ ...source, refunds: [{ type: "full", amount: 302000, status: "active" }] }];
    Object.assign(h.state.tables.invoice_session_terms[0], { amount: 312000, allocation_line_index: 0, allocation_amount: 312000, allocation_source: source, allocation_base_amount: 312000 });
    expect((await getSessionTermsView("2026-09")).rows[0]).toMatchObject({ amount: 312000, allocatedAmount: 0, classAmount: 0, allocationStale: false, refundState: "full" });
    expect((await getSessionVerificationView("2026-09")).rows[0]).toMatchObject({ allocatedAmount: 0 });
    expect(h.state.writes).toEqual([]);
  });
  it("EiE 확정 시수만 바꿀 때 월 단가·금액·배분 필드를 쓰지 않는다", async () => {
    Object.assign(h.state.tables.invoice_session_terms[0], { pricing_mode: "monthly", unit_price: 270000, amount: 270000, allocation_amount: 260000 });
    h.state.billing = { eieMonthlyPrice: 290000 };
    expect(await updateMonthlyTermSessions("term", 15.5, "2026-09-01")).toMatchObject({ terms: [{ confirmedSessions: 15.5, unitPrice: 270000, amount: 270000 }] });
    expect(h.state.writes[0].patch).not.toHaveProperty("amount");
    expect(h.state.writes[0].patch).not.toHaveProperty("unit_price");
    expect(h.state.tables.invoice_session_terms[0].allocation_amount).toBe(260000);
  });
  it("날짜 정정 뒤 조회는 최신 계획을 사용하고 0이 되어도 확정값·배분을 보존한다", async () => {
    h.state.tables.enrollments = [{ student_id: "student", class_id: "class", start_date: "2026-01-01", end_date: "2026-09-01", attendance_days: [], on_hold: false, is_transferred: false, class: { subject: "english", is_active: true } }];
    h.state.tables.class_schedules = [{ class_id: "class", day_of_week: "tue", start_time: "16:00", end_time: "16:55", valid_from: "2026-01-01", valid_to: null, slot_teacher_label: null }];
    expect((await getSessionTermsView("2026-09")).rows[0].plannedSessions).toBe(1);
    h.state.tables.enrollments[0].end_date = "2026-08-31";
    expect((await getSessionTermsView("2026-09")).rows[0]).toMatchObject({ plannedSessions: 0, confirmedSessions: 8, amount: 327000 });
    expect(h.state.writes).toEqual([]);
  });
  it("계획 갱신은 개인 등원 요일을 지키고 JJ·LAB 교시를 포함한다", async () => {
    h.state.tables.enrollments = [{ student_id: "student", class_id: "class", start_date: "2026-01-01", end_date: null, attendance_days: ["mon"], class: { subject: "english", is_active: true } }];
    h.state.tables.class_schedules = [
      { class_id: "class", day_of_week: "mon", start_time: "16:00", end_time: "16:55", valid_from: "2026-01-01", valid_to: null, slot_teacher_label: null },
      { class_id: "class", day_of_week: "mon", start_time: "17:00", end_time: "17:55", valid_from: "2026-01-01", valid_to: null, slot_teacher_label: "JJ" },
      { class_id: "class", day_of_week: "mon", start_time: "18:00", end_time: "18:55", valid_from: "2026-01-01", valid_to: null, slot_teacher_label: "LAB" },
      { class_id: "class", day_of_week: "thu", start_time: "18:00", end_time: "18:55", valid_from: "2026-01-01", valid_to: null, slot_teacher_label: "LAB" },
    ];
    expect(await refreshPlannedTerms("2026-09")).toMatchObject({ ok: true, refreshed: 1 });
    expect(h.state.writes.find((w) => w.table === "invoice_session_terms")?.patch).toMatchObject({ planned_sessions: 12 });
    expect(h.state.writes[0].patch).not.toHaveProperty("confirmed_sessions");
  });
  it("미확정 반의 배분도 재조회에서 유지하고 시수·단가는 확정하지 않는다", async () => {
    const source = { kind: "수업", description: "수업료", amount: 300000, discount: 20000 };
    h.state.tables.invoices[0].line_items = [source];
    Object.assign(h.state.tables.invoice_session_terms[0], { confirmed_sessions: null, unit_price: null, amount: null, confirmed_at: null, allocation_line_index: 0, allocation_amount: 300000, allocation_source: source, allocation_base_amount: null });
    expect((await getSessionTermsView("2026-09")).rows[0]).toMatchObject({ confirmedSessions: null, unitPrice: null, allocatedAmount: 300000, allocationStale: false });
    expect(h.state.writes).toEqual([]);
    // 시간표에서 사라져도 계획 갱신이 저장한 배분을 삭제하지 않는다.
    expect(await refreshPlannedTerms("2026-09")).toMatchObject({ ok: true, refreshed: 0 });
    expect(h.state.tables.invoice_session_terms[0].allocation_amount).toBe(300000);
    expect(h.state.writes).toEqual([{ table: "invoice_session_terms", patch: { planned_sessions: 0 } }]);
  });
  it("소수 시수 확정은 출석부 기준을 저장하고 원 단위 금액으로 응답한다", async () => {
    const fd = new FormData(); fd.set("id", "term"); fd.set("sessions", "4.5"); fd.set("unitPrice", "31250");
    expect(await confirmSessionTerm(undefined, fd)).toMatchObject({ terms: [{ confirmedSessions: 4.5, amount: 140625, quantityBasis: "attendance_units" }] });
    expect(h.state.tables.invoice_session_terms[0]).toMatchObject({ confirmed_sessions: 4.5, amount: 140625, quantity_basis: "attendance_units" });
    expect(await confirmClassTerms("2026-09", "class", 31250, 1.5)).toMatchObject({ terms: [{ confirmedSessions: 1.5, amount: 46875 }] });
    expect(await confirmClassTerms("2026-09", "class", 31250, 1.55)).toHaveProperty("error");
  });
  it("청구액 배분을 한 학생에게 새 확정 반이 생기면 미연결 반을 안내하고 분배 저장을 막는다", async () => {
    const source = { kind: "수업", description: "수업료", amount: 300000, discount: 20000 };
    h.state.tables.invoices[0].line_items = [source];
    Object.assign(h.state.tables.invoice_session_terms[0], { allocation_line_index: 0, allocation_amount: 300000, allocation_source: source, allocation_base_amount: 327000 });
    expect((await getSessionTermsView("2026-09")).rows[0]).toMatchObject({ allocatedAmount: 300000, allocationStale: false });
    h.state.tables.invoice_session_terms.push({ ...h.state.tables.invoice_session_terms[0], id: "term2", class_id: "class2", allocation_line_index: null });
    expect((await getSessionTermsView("2026-09")).rows.find((r) => r.id === "term2")).toMatchObject({ allocationStale: true });
    const fd = new FormData(); fd.set("period", "2026-09");
    expect(await saveTeacherSplits(undefined, fd)).toHaveProperty("error");
    expect(h.state.writes).toEqual([]);
  });
  it("설정 수정 뒤 다음 조회는 새 후보를 쓰고 이미 확정한 단가·금액은 보존한다", async () => {
    expect((await getSessionTermsView("2026-09")).catalog).toHaveLength(13);
    h.state.billing = { sessionPrices: [{ price: 26000, label: "공통" }] };
    const view = await getSessionTermsView("2026-09");
    expect(view.catalog).toEqual([{ price: 26000, label: "공통" }]);
    expect(view.rows[0]).toMatchObject({ unitPrice: 40875, amount: 327000, confirmedSessions: 8, monthlyPrice: null });
    expect(h.state.writes).toEqual([]);
  });

  it("EiE 행은 설정의 월 금액을 읽으며 기존 확정값은 유지한다", async () => {
    h.state.tables.invoice_session_terms[0].class = { class_name: "JP1", english_track: "eie" };
    h.state.billing = { eieMonthlyPrice: 280000 };
    expect((await getSessionTermsView("2026-09")).rows[0]).toMatchObject({ monthlyPrice: 280000, amount: 327000 });
  });

  it("EiE는 개별·반 일괄 모두 서버 설정의 월 금액으로 확정한다(클라이언트 단가·구분 위조 무시)", async () => {
    h.state.tables.classes[0].english_track = "eie";
    h.state.tables.invoice_session_terms[0].class = { english_track: "eie" };
    const fd = new FormData();
    fd.set("id", "term"); fd.set("sessions", "12"); fd.set("unitPrice", "999999"); fd.set("pricingMode", "per_session");
    expect(await confirmSessionTerm(undefined, fd)).toMatchObject({ ok: true });
    expect(h.state.writes[0].patch).toMatchObject({ pricing_mode: "monthly", unit_price: 270000, amount: 270000 });
    h.state.billing = { eieMonthlyPrice: 280000 };
    expect(await confirmClassTerms("2026-09", "class", 999999, 18)).toMatchObject({ confirmed: 1 });
    expect(h.state.writes[1].patch).toMatchObject({ pricing_mode: "monthly", unit_price: 280000, amount: 280000 });
  });

  it("월 고정 상태는 출석 회차와 비교하지 않으며, 확정 전에는 미확정이다", async () => {
    h.state.tables.invoice_session_terms[0].class = { english_track: "eie" };
    h.state.tables.invoice_session_terms[0].pricing_mode = "monthly";
    expect((await getSessionVerificationView("2026-09")).rows[0]).toMatchObject({ amount: 327000, status: "monthly", diff: null });
    h.state.tables.invoice_session_terms[0].confirmed_sessions = null;
    expect((await getSessionVerificationView("2026-09")).rows[0].status).toBe("unconfirmed");
    expect(h.state.writes).toEqual([]);
  });

  it("일반 영어의 선택 단가는 그대로 회차에 곱해 확정한다", async () => {
    const fd = new FormData();
    fd.set("id", "term"); fd.set("sessions", "8"); fd.set("unitPrice", "24,000");
    expect(await confirmSessionTerm(undefined, fd)).toMatchObject({ ok: true });
    expect(h.state.writes[0].patch).toMatchObject({ confirmed_sessions: 8, unit_price: 24000, amount: 192000 });
    expect(await confirmClassTerms("2026-09", "class", 25000, 9)).toMatchObject({ confirmed: 1 });
    expect(h.state.writes[1].patch).toMatchObject({ confirmed_sessions: 9, unit_price: 25000, amount: 225000 });
  });

  it("EiE 월 확정 → 분배 스냅샷 저장 → 강사 정산까지 같은 월 금액을 사용한다", async () => {
    h.state.tables.classes[0] = { id: "class", subject: "english", english_track: "eie", class_name: "JP1", teacher: { id: "teacher", display_name: "강사" } };
    h.state.tables.invoice_session_terms[0].class = { class_name: "JP1", english_track: "eie" };
    h.state.tables.users = [{ id: "teacher", salary_type: "commission", commission_rate: 50, monthly_base: 0 }];
    // 월 정액은 출석 비례 요일 안분도 하지 않는다.
    h.state.tables.class_salary_settings = [{ class_id: "class", applies_dows: ["sat"] }];
    expect(await confirmClassTerms("2026-09", "class", 270000)).toMatchObject({ confirmed: 1 });
    const fd = new FormData(); fd.set("period", "2026-09");
    expect(await saveTeacherSplits(undefined, fd)).toEqual({ saved: 1, skipped: 0 });
    expect(h.state.tables.invoice_teacher_splits[0]).toMatchObject({ pricing_mode: "monthly", confirmed_amount: 270000, actual_amount: 270000 });
    h.state.billing = { eieMonthlyPrice: 280000 }; // 이미 확정·저장한 달은 바뀌지 않는다.
    expect((await getTeacherSettlementView("2026-09")).rows[0]).toMatchObject({ payableTotal: 270000, settlement: 122985, status: "computed" });
  });

  it("일반 수업의 빈 회차를 계획 회차나 0회로 확정하지 않는다", async () => {
    expect(await confirmClassTerms("2026-09", "class", 21250)).toHaveProperty("error");
    const fd = new FormData(); fd.set("id", "term"); fd.set("unitPrice", "21250"); fd.set("sessions", "");
    expect(await confirmSessionTerm(undefined, fd)).toHaveProperty("error");
    expect(h.state.writes).toEqual([]);
  });

  it("해제는 확정값만 지우며 응답 뒤 감사로그·캐시 무효화를 처리한다", async () => {
    const fd = new FormData(); fd.set("id", "term");
    expect(await unconfirmSessionTerm(undefined, fd)).toMatchObject({ ok: true, terms: [{ id: "term", confirmedSessions: null, unitPrice: null, amount: null }] });
    expect(h.state.tables.invoice_session_terms[0]).toMatchObject({ planned_sessions: 9, confirmed_sessions: null, unit_price: null, amount: null });
    expect(h.state.writes.map((w) => w.table)).toEqual(["invoice_session_terms"]);
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(logAction).not.toHaveBeenCalled();
    expect(h.state.after).toHaveLength(1);
    await h.state.after[0]();
    expect(revalidatePath).toHaveBeenCalledWith("/billing");
    expect(logAction).toHaveBeenCalledWith(expect.objectContaining({ action: "session_term_unconfirm", metadata: expect.objectContaining({ sessionsBefore: 8, unitPriceBefore: 40875, amountBefore: 327000 }) }));
  });
});
