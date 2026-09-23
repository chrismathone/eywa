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
import { updateSessionTermNote } from "./note-actions";
import { confirmSelectedTerms } from "./selected-confirm-actions";
import { unconfirmClassTerms } from "./class-unconfirm-actions";
import { saveReceiptAllocation } from "./receipt-allocation-actions";

const h = vi.hoisted(() => {
  const state = {
    tables: {} as Record<string, Record<string, unknown>[]>,
    billing: {} as Record<string, unknown>,
    writes: [] as { table: string; patch: Record<string, unknown> }[],
    deletes: [] as string[],
    /** update가 이 id를 하나라도 담으면 트리거 예외처럼 실패한다(묶음 실패 → 한 명씩 재시도 검증). */
    failIds: [] as string[],
    after: [] as (() => Promise<void>)[],
  };
  const client = {
    rpc: () => ({ range: () => Promise.resolve({ data: [], error: null }) }),
    from(table: string) {
      let single = false;
      let patch: Record<string, unknown> | undefined;
      let upserts: Record<string, unknown>[] | undefined;
      let ignoreDuplicates = false;
      let inIds: string[] | undefined;
      const builder: Record<string, unknown> = {};
      let periodEq: string | undefined;
      for (const method of ["select", "eq", "neq", "order", "range", "gte", "gt", "lte", "or", "not", "is"]) builder[method] = () => builder;
      // 청구 기간(`period`)만은 거른다 — 지난 달 기준 로더가 어느 달을 읽는지 잠그려고. 기간이 없는 행은 그대로 통과(다른 테스트 불변).
      builder.eq = (column: string, value: unknown) => { if (column === "period") periodEq = value as string; return builder; };
      builder.in = (column: string, values: string[]) => { if (column === "id") inIds = values; return builder; };
      builder.delete = () => { state.deletes.push(table); return builder; };
      builder.maybeSingle = () => { single = true; return builder; };
      builder.update = (value: Record<string, unknown>) => { patch = value; return builder; };
      builder.upsert = (values: Record<string, unknown>[], options?: { ignoreDuplicates?: boolean }) => { upserts = values; ignoreDuplicates = options?.ignoreDuplicates === true; return builder; };
      builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
        if (patch && inIds?.some((id) => state.failIds.includes(id))) {
          return Promise.resolve({ data: null, error: { message: "배분금액이 있는 반은 0시수로 확정할 수 없습니다. 시수 또는 배분금액을 확인해 주세요" } }).then(resolve, reject);
        }
        if (patch) {
          state.writes.push({ table, patch });
          state.tables[table] = (state.tables[table] ?? []).map((row) => (inIds && !inIds.includes(row.id as string) ? row : { ...row, ...patch }));
        }
        // 회차 행 생성(ignoreDuplicates) — 같은 (청구서·반) 행이 있으면 건너뛰고, 새로 넣은 행만 돌려준다(ON CONFLICT DO NOTHING RETURNING).
        if (upserts && ignoreDuplicates) {
          const rows = (state.tables[table] ??= []);
          const inserted = upserts
            .filter((row) => !rows.some((r) => r.invoice_id === row.invoice_id && r.class_id === row.class_id))
            .map((row, i) => ({ id: `made-${rows.length + i + 1}`, confirmed_sessions: null, ...row }));
          rows.push(...inserted);
          state.writes.push(...upserts.map((row) => ({ table, patch: row })));
          return Promise.resolve({ data: inserted, error: null }).then(resolve, reject);
        }
        if (upserts) {
          state.tables[table] = upserts;
          state.writes.push(...upserts.map((row) => ({ table, patch: row })));
        }
        const all = (state.tables[table] ?? []).filter((row) => periodEq === undefined || !("period" in row) || row.period === periodEq);
        // update … .select()는 실제로 바꾼 행만 돌려준다(id로 좁힌 경우).
        const rows = patch && inIds ? all.filter((row) => inIds!.includes(row.id as string)) : all;
        return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null }).then(resolve, reject);
      };
      return builder;
    },
  };
  return { state, client };
});

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => h.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.client }));
vi.mock("@/lib/auth/super-admin", () => ({ isCurrentUserSuperAdmin: async () => false }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: async () => resolveSettings({ billing: h.state.billing }, { name: "학원" }) }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => ({ id: "owner", tenantId: "tenant", systemRole: "master" }) }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canWriteTenant: async () => true }));
vi.mock("@/features/audit/server/log", () => ({ logAction: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// 세션 기간 정의 없음 = 달력월(줄 집합의 기간 창).
vi.mock("@/features/periods/server/queries", () => ({ getPeriodDefs: async () => [] }));
vi.mock("next/server", () => ({ after: (fn: () => Promise<void>) => h.state.after.push(fn) }));

beforeEach(() => {
  vi.clearAllMocks();
  h.state.after = [];
  h.state.billing = {};
  h.state.writes = [];
  h.state.deletes = [];
  h.state.failIds = [];
  h.state.tables = {
    invoices: [{ id: "invoice", student_id: "student", line_items: [] }],
    students: [{ id: "student", name: "학생", grade: "중1" }],
    classes: [{ id: "class", subject: "english", english_track: "injaewon" }],
    invoice_session_terms: [{ id: "term", invoice_id: "invoice", class_id: "class", subject: "english", planned_sessions: 9, confirmed_sessions: 8, unit_price: 40875, amount: 327000, confirmed_at: "2026-09-01", note: null, class: { class_name: "영어반", english_track: "injaewon" }, invoice: { period: "2026-09", student_id: "student", status: "issued" } }],
  };
});

/**
 * 반 일괄 확정은 **이번 달 예정(live plan)이 있는 줄만** 대상이다(화면 `batchEligible`과 같은 축) — 수강·시간표를 심어 예정을 만든다.
 * 쌍 = [학생, 반, 과목]. 월요일 한 교시(55분) 배치 = 9월 월요일마다 예정이 선다.
 */
function seedPlan(pairs: [string, string, string][]) {
  h.state.tables.enrollments = pairs.map(([student, klass, subject]) => ({
    student_id: student, class_id: klass, start_date: "2026-01-01", end_date: null, attendance_days: null, on_hold: false, is_transferred: false,
    class: { subject, is_active: true },
  }));
  h.state.tables.class_schedules = [...new Set(pairs.map((p) => p[1]))].map((klass) => ({
    class_id: klass, day_of_week: "mon", start_time: "16:00", end_time: "16:55", valid_from: "2026-01-01", valid_to: null, slot_teacher_label: null,
  }));
}

describe("설정 → 회차 화면 조회·확정", () => {
  it("수동 합산의 한 반만 전액환불이면 그 반은 0원, 나머지는 합산 해제 전 분배 저장을 막는다", async () => {
    const full = { kind: "수업", description: "영어반", amount: 312000, refunds: [{ type: "full", amount: 302000, status: "active" }] };
    h.state.tables.invoices[0].line_items = [{ kind: "수업", description: "합산", receiptGroupId: "group", amount: 612000, sourceItems: [full, { kind: "수업", description: "수학반", amount: 300000 }] }];
    h.state.tables.invoice_session_terms.push({ ...h.state.tables.invoice_session_terms[0], id: "math", class_id: "math", class: { class_name: "수학반" } });
    const view = await getSessionTermsView("2026-09");
    expect(view.rows.find((r) => r.id === "term")).toMatchObject({ allocatedAmount: 0, refundState: "full" });
    expect(view.rows.find((r) => r.id === "math")).toMatchObject({ allocationStale: true });
    const fd = new FormData(); fd.set("period", "2026-09");
    expect(await saveTeacherSplits(undefined, fd)).toHaveProperty("error");
    expect(h.state.writes).toEqual([]);
  });
  it("전체환불은 기존 확정값을 보존하면서 배분·분배의 기준액을 0으로 읽는다", async () => {
    const source = { kind: "수업", description: "영어반", amount: 312000, discount: 10000, paid: 302000 };
    h.state.tables.invoices[0].line_items = [{ ...source, refunds: [{ type: "full", amount: 302000, status: "active" }] }];
    Object.assign(h.state.tables.invoice_session_terms[0], { amount: 312000, allocation_line_index: 0, allocation_amount: 312000, allocation_source: source, allocation_base_amount: 312000 });
    expect((await getSessionTermsView("2026-09")).rows[0]).toMatchObject({ amount: 312000, allocatedAmount: 0, classAmount: 0, allocationStale: false, refundState: "full" });
    expect((await getSessionVerificationView("2026-09")).rows[0]).toMatchObject({ allocatedAmount: 0 });
    expect(h.state.writes).toEqual([]);
  });
  it("연결 없이 0원으로 저장한 확정 반은 배분 0원·재확인 아님, 청구 항목이 바뀌면 재확인 (0269a)", async () => {
    const line = { kind: "수업", description: "수학반", amount: 148750, discount: 0, paid: 148750 };
    h.state.tables.invoices[0].line_items = [line];
    h.state.tables.invoice_session_terms.push({ ...h.state.tables.invoice_session_terms[0], id: "math", class_id: "math", amount: 148750, allocation_line_index: 0, allocation_amount: 148750, allocation_source: line, allocation_base_amount: 148750, class: { class_name: "수학반" } });
    Object.assign(h.state.tables.invoice_session_terms[0], { allocation_line_index: null, allocation_amount: 0, allocation_source: [line], allocation_base_amount: 327000 });
    const rows = (await getSessionTermsView("2026-09")).rows;
    expect(rows.find((r) => r.id === "term")).toMatchObject({ allocatedAmount: 0, allocationStale: false, invoiceHasAllocations: true });
    expect(rows.find((r) => r.id === "math")).toMatchObject({ allocatedAmount: 148750, allocationStale: false });
    h.state.tables.invoices[0].line_items = [line, { kind: "수업", description: "영어반", amount: 327000 }];
    expect((await getSessionTermsView("2026-09")).rows.find((r) => r.id === "term")).toMatchObject({ allocatedAmount: null, allocationStale: true });
    // 서버 액션: 항목 없는 행은 0원만 · 한 반 이상 연결해야 · 남은 수업 항목이 있거나 이름이 맞는 항목이 있는 반은 0원 불가.
    const linkedMath = { termId: "math", lineIndex: 0, amount: 148750, baseAmount: 148750, confirmedAt: "2026-09-01" };
    const zeroTerm = { termId: "term", lineIndex: null, amount: 0, baseAmount: 327000, confirmedAt: "2026-09-01" };
    expect(await saveReceiptAllocation("invoice", [line], [{ ...zeroTerm, amount: 5 }])).toEqual({ error: "배분금액과 연결 항목을 확인해 주세요" });
    expect(await saveReceiptAllocation("invoice", [line], [zeroTerm])).toHaveProperty("error", expect.stringContaining("한 반 이상 연결"));
    const english = { kind: "수업", description: "영어반", amount: 327000 };
    expect(await saveReceiptAllocation("invoice", [line, english], [linkedMath, zeroTerm])).toHaveProperty("error", expect.stringContaining("영어반에 맞는 수납 항목이 있습니다"));
    const other = { kind: "수업", description: "특강", amount: 50000 };
    expect(await saveReceiptAllocation("invoice", [line, other], [linkedMath, zeroTerm])).toHaveProperty("error", expect.stringContaining("확인한 뒤 다시 저장"));
    expect(await saveReceiptAllocation("invoice", [line, other], [linkedMath, { ...zeroTerm, ackUnlinked: true }])).toEqual({ ok: true });
    expect(await saveReceiptAllocation("invoice", [line], [linkedMath, zeroTerm])).toEqual({ ok: true });
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
  it("조회 행에 반의 그 달 수업 요일과, 다를 때만 개별 등원 요일을 싣는다", async () => {
    h.state.tables.enrollments = [{ student_id: "student", class_id: "class", start_date: "2026-01-01", end_date: null, attendance_days: ["thu"], on_hold: false, is_transferred: false, class: { subject: "english", is_active: true } }];
    h.state.tables.class_schedules = [
      { class_id: "class", day_of_week: "mon", start_time: "16:00", end_time: "16:55", valid_from: "2026-01-01", valid_to: null, slot_teacher_label: null },
      { class_id: "class", day_of_week: "thu", start_time: "16:00", end_time: "16:55", valid_from: "2026-01-01", valid_to: null, slot_teacher_label: null },
    ];
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-09-17T03:00:00Z"));
      expect((await getSessionTermsView("2026-09")).rows[0]).toMatchObject({ classDays: [1, 4], attendDays: [4] });
      // 등원 요일은 지금 값 하나라 지난 달 표엔 싣지 않는다(반 요일은 배치 이력이라 그대로).
      vi.setSystemTime(new Date("2026-10-02T03:00:00Z"));
      expect((await getSessionTermsView("2026-09")).rows[0]).toMatchObject({ classDays: [1, 4], attendDays: null });
      vi.setSystemTime(new Date("2026-09-17T03:00:00Z"));
      h.state.tables.enrollments[0].attendance_days = [];
      expect((await getSessionTermsView("2026-09")).rows[0]).toMatchObject({ classDays: [1, 4], attendDays: null });
    } finally {
      vi.useRealTimers();
    }
  });

  /** 이번 달(9월) 청구서 1 + 지난 달(8월) 청구서 1 · 8월 확정 6시수 × 21,250원 · 수강·배치(월 1교시)까지. */
  const seedLastMonth = () => {
    h.state.tables.invoices[0].period = "2026-09";
    h.state.tables.invoices.push({ id: "prev", student_id: "student", line_items: [], period: "2026-08" });
    Object.assign(h.state.tables.invoice_session_terms[0], { confirmed_sessions: null, unit_price: null, amount: null, confirmed_at: null });
    h.state.tables.invoice_session_terms.push({ id: "old", invoice_id: "prev", class_id: "class", subject: "english", planned_sessions: 7, confirmed_sessions: 6, unit_price: 21250, amount: 127500, pricing_mode: "per_session", quantity_basis: "attendance_units", confirmed_at: "2026-08-30", note: null, class: { class_name: "영어반", english_track: "injaewon" } });
    const enrollment = { student_id: "student", class_id: "class", start_date: "2026-01-01", end_date: null, attendance_days: ["mon"], on_hold: false, class: { subject: "english", is_active: true } };
    h.state.tables.enrollments = [enrollment];
    h.state.tables.class_schedules = [{ class_id: "class", day_of_week: "mon", start_time: "16:00", end_time: "16:55", valid_from: "2026-01-01", valid_to: null, slot_teacher_label: null }];
    return enrollment;
  };
  const lastOf = async (id = "term") => (await getSessionTermsView("2026-09", undefined, { lastMonth: true })).rows.find((r) => r.id === id)?.lastMonth ?? null;

  it("지난 달 기준 미리 채우기 — 회차 확정 면에서만 읽고, 미확정 행에 **지난 달** 확정 단가를 싣는다", async () => {
    seedLastMonth();
    expect((await getSessionTermsView("2026-09")).rows.find((r) => r.id === "term")?.lastMonth ?? null).toBeNull();
    expect(await lastOf()).toMatchObject({ price: 21250, last: { sessions: 6, price: 21250 } });
    // 기간 연결 — 로더가 지난 달이 아니라 이번 달 청구서를 읽으면 확정 행이 없어 제안이 사라진다.
    h.state.tables.invoices[1].period = "2026-07";
    expect(await lastOf()).toBeNull();
  });

  it("지난 달 기준 조회가 깨져도 목록은 그대로 뜬다(제안만 없음 + 서버 로그)", async () => {
    seedLastMonth();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const original = h.client.from.bind(h.client);
    let invoiceCalls = 0;
    const fromSpy = vi.spyOn(h.client, "from").mockImplementation((table: string) => {
      // 첫 청구서 조회 = 이번 달 목록, 둘째 = 지난 달 기준 로더.
      if (table === "invoices" && ++invoiceCalls === 2) throw new Error("boom");
      return original(table);
    });
    try {
      const view = await getSessionTermsView("2026-09", undefined, { lastMonth: true });
      expect(view.rows.find((r) => r.id === "term")).toMatchObject({ confirmedSessions: null, lastMonth: null });
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      fromSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it("🔴 지난 달 기준 미리 채우기 — 예정 0·휴원(예정 불확실)·이번 달 회차 행 중복(확정 포함)·지난 달 확정 중복·EiE 월 정액은 채우지 않는다", async () => {
    const enrollment = seedLastMonth();
    expect(await lastOf()).not.toBeNull();
    // 수강·배치가 없으면 이번 달 예정 0 — 단가만 채우면 0원으로 일괄 확정된다.
    h.state.tables.enrollments = [];
    expect(await lastOf()).toBeNull();
    // 예정은 0보다 큰데 불확실(같은 반에 휴원 수강 이력)이면 채우지 않는다 — 예정 0 경로와 따로 잠근다.
    h.state.tables.enrollments = [enrollment, { ...enrollment, on_hold: true, end_date: "2026-09-05" }];
    expect(await lastOf()).toBeNull();
    h.state.tables.enrollments = [enrollment];
    expect(await lastOf()).not.toBeNull();
    // 이번 달 EiE 월 정액 행.
    h.state.tables.invoice_session_terms[0].class = { class_name: "영어반", english_track: "eie" };
    expect(await lastOf()).toBeNull();
    h.state.tables.invoice_session_terms[0].class = { class_name: "영어반", english_track: "injaewon" };
    // 지난 달 확정이 둘이면 어느 쪽이 맞는지 모른다.
    h.state.tables.invoice_session_terms.push({ ...h.state.tables.invoice_session_terms[1], id: "old2", confirmed_sessions: 0 });
    expect(await lastOf()).toBeNull();
    h.state.tables.invoice_session_terms.pop();
    expect(await lastOf()).not.toBeNull();
    // 이번 달 같은 학생·반 회차 행이 둘 — 한쪽이 이미 확정이어도.
    h.state.tables.invoices.push({ id: "invoice2", student_id: "student", line_items: [], period: "2026-09" });
    h.state.tables.invoice_session_terms.push({ ...h.state.tables.invoice_session_terms[0], id: "dup", invoice_id: "invoice2", confirmed_sessions: 9, unit_price: 21250, amount: 191250, confirmed_at: "2026-09-10" });
    expect(await lastOf()).toBeNull();
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
    seedPlan([["student", "class", "english"]]);
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
    seedPlan([["student", "class", "english"]]);
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
    seedPlan([["student", "class", "english"]]);
    expect(await confirmClassTerms("2026-09", "class", 25000, 9)).toMatchObject({ confirmed: 1 });
    expect(h.state.writes[1].patch).toMatchObject({ confirmed_sessions: 9, unit_price: 25000, amount: 225000 });
  });

  it("EiE 월 확정 → 분배 스냅샷 저장 → 강사 정산까지 같은 월 금액을 사용한다", async () => {
    h.state.tables.classes[0] = { id: "class", subject: "english", english_track: "eie", class_name: "JP1", teacher: { id: "teacher", display_name: "강사" } };
    h.state.tables.invoice_session_terms[0].class = { class_name: "JP1", english_track: "eie" };
    h.state.tables.users = [{ id: "teacher", salary_type: "commission", commission_rate: 50, monthly_base: 0 }];
    // 월 정액은 출석 비례 요일 안분도 하지 않는다.
    h.state.tables.class_salary_settings = [{ class_id: "class", applies_dows: ["sat"] }];
    seedPlan([["student", "class", "english"]]);
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

  it("회차 행은 학교(학년과 따로)·현재 담임 이름을 싣는다 — 모르면 null", async () => {
    h.state.tables.students[0].school = "칠성초";
    h.state.tables.invoice_session_terms[0].class = { class_name: "영어반", english_track: "injaewon", teacher: { display_name: "이수진" } };
    expect((await getSessionTermsView("2026-09")).rows[0]).toMatchObject({ studentSchool: "칠성초", studentGrade: "중1", homeroomTeacherName: "이수진" });
    h.state.tables.invoice_session_terms[0].class = { class_name: "영어반", english_track: "injaewon", teacher: null };
    delete h.state.tables.students[0].school;
    expect((await getSessionTermsView("2026-09")).rows[0]).toMatchObject({ studentSchool: null, homeroomTeacherName: null });
  });

  it("메모 저장은 note 한 칸만 쓰고(줄바꿈은 공백으로) 응답 뒤 감사로그를 남긴다 — 같은 값·너무 긴 값은 안 쓴다", async () => {
    Object.assign(h.state.tables.invoice_session_terms[0], { invoice: { student_id: "student" } });
    expect(await updateSessionTermNote("term", "  10/5 보강\n  1회 추가 ")).toEqual({ note: "10/5 보강 1회 추가" });
    expect(h.state.writes).toEqual([{ table: "invoice_session_terms", patch: { note: "10/5 보강 1회 추가" } }]);
    expect(h.state.tables.invoice_session_terms[0]).toMatchObject({ confirmed_sessions: 8, amount: 327000 });
    expect(logAction).not.toHaveBeenCalled();
    await h.state.after[0]();
    expect(revalidatePath).toHaveBeenCalledWith("/billing");
    expect(logAction).toHaveBeenCalledWith(expect.objectContaining({ action: "session_term_note", metadata: expect.objectContaining({ termId: "term", studentId: "student", note: "10/5 보강 1회 추가", noteBefore: null }) }));
    // 같은 값이면 쓰지 않는다.
    expect(await updateSessionTermNote("term", "10/5 보강 1회 추가")).toEqual({ note: "10/5 보강 1회 추가" });
    expect(h.state.writes).toHaveLength(1);
    expect(await updateSessionTermNote("term", "가".repeat(301))).toHaveProperty("error");
    expect(h.state.writes).toHaveLength(1);
    // 비우면 null(메모 없음)로 지운다.
    expect(await updateSessionTermNote("term", "   ")).toEqual({ note: null });
    expect(h.state.writes[1]).toEqual({ table: "invoice_session_terms", patch: { note: null } });
  });

  it("계획 갱신이 시간표에서 빠진 미확정 행을 지울 때 메모는 막지 않고 감사로그에 원문을 남긴다", async () => {
    Object.assign(h.state.tables.invoice_session_terms[0], { confirmed_sessions: null, unit_price: null, amount: null, confirmed_at: null, allocation_line_index: null, note: "환불 문의 중" });
    expect(await refreshPlannedTerms("2026-09")).toMatchObject({ ok: true, refreshed: 0 });
    expect(h.state.deletes).toEqual(["invoice_session_terms"]);
    expect(logAction).toHaveBeenCalledWith(expect.objectContaining({ action: "session_terms_refresh", metadata: expect.objectContaining({ removed: 1, removedNotes: [expect.objectContaining({ termId: "term", note: "환불 문의 중" })] }) }));
  });

  it("선택 일괄 확정은 행마다 받은 시수 × 단가로 미확정 행만 쓰고, EiE는 서버 월 금액을 쓴다", async () => {
    Object.assign(h.state.tables.invoice_session_terms[0], { confirmed_sessions: null, unit_price: null, amount: null, confirmed_at: null });
    const CLASS = "00000000-0000-4000-8000-000000000001";
    expect(await confirmSelectedTerms("2026-09", CLASS, [{ id: "term", sessions: 4.5, unitPrice: 31250, monthly: false }])).toMatchObject({ confirmed: 1, skipped: 0, terms: [{ id: "term", confirmedSessions: 4.5, unitPrice: 31250, amount: 140625, quantityBasis: "attendance_units" }] });
    expect(h.state.writes).toEqual([{ table: "invoice_session_terms", patch: expect.objectContaining({ confirmed_sessions: 4.5, unit_price: 31250, amount: 140625, pricing_mode: "per_session", quantity_basis: "attendance_units" }) }]);
    expect(logAction).not.toHaveBeenCalled();
    await h.state.after[0]();
    expect(logAction).toHaveBeenCalledWith(expect.objectContaining({ action: "session_term_confirm_selected", metadata: expect.objectContaining({ classId: CLASS, confirmedCount: 1, failedCount: 0, items: [{ termId: "term", sessions: 4.5, unitPrice: 31250, amount: 140625, pricingMode: "per_session" }] }) }));
    // 이미 확정된 행은 건너뛴다(다른 창이 먼저 확정한 값을 덮지 않는다).
    expect(await confirmSelectedTerms("2026-09", CLASS, [{ id: "term", sessions: 3, unitPrice: 20000, monthly: false }])).toMatchObject({ error: expect.stringContaining("이미 확정"), skipped: 1 });
    expect(h.state.writes).toHaveLength(1);
    // 잘못된 값·반 없음은 아무것도 안 쓴다.
    Object.assign(h.state.tables.invoice_session_terms[0], { confirmed_sessions: null });
    expect(await confirmSelectedTerms("2026-09", CLASS, [{ id: "term", sessions: 1.55, unitPrice: 20000, monthly: false }])).toHaveProperty("error");
    expect(await confirmSelectedTerms("2026-09", CLASS, [])).toHaveProperty("error");
    expect(await confirmSelectedTerms("2026-09", "noclass:반 미지정", [{ id: "term", sessions: 3, unitPrice: 20000, monthly: false }])).toEqual({ error: "반이 지정되지 않았습니다" });
    expect(h.state.writes).toHaveLength(1);
    // EiE 월 정액 — 판정은 회차 행의 과목 + 반의 영어 구분(개별 확정과 같다), 화면이 보낸 단가는 무시하고 설정의 월 금액.
    h.state.tables.invoice_session_terms[0].class = { class_name: "JP1", english_track: "eie" };
    h.state.billing = { eieMonthlyPrice: 280000 };
    expect(await confirmSelectedTerms("2026-09", CLASS, [{ id: "term", sessions: 12, unitPrice: 999999, monthly: true }])).toMatchObject({ terms: [{ unitPrice: 280000, amount: 280000, pricingMode: "monthly" }] });
  });

  it("전체 확정 해제 — 보낸 학생 중 확정된 행만 지우고, 지우기 전 값을 감사로그에 남긴다 · 한 명이 막혀도 나머지는 해제", async () => {
    const CLASS = "00000000-0000-4000-8000-000000000001";
    h.state.tables.invoice_session_terms.push(
      { ...h.state.tables.invoice_session_terms[0], id: "term2", confirmed_sessions: 7, unit_price: 21250, amount: 148750 },
      { ...h.state.tables.invoice_session_terms[0], id: "open", confirmed_sessions: null, unit_price: null, amount: null, confirmed_at: null },
    );
    const res = await unconfirmClassTerms("2026-09", CLASS, ["term", "term2", "open"]);
    // 이미 미확정이던 행('open')도 화면 보정용으로 돌려주되 해제 수·감사로그엔 안 센다.
    expect(res).toMatchObject({ unconfirmed: 2, skipped: 1, failedIds: [], terms: [{ id: "term", confirmedSessions: null, amount: null }, { id: "term2", confirmedSessions: null }, { id: "open", confirmedSessions: null }] });
    expect(h.state.writes).toEqual([{ table: "invoice_session_terms", patch: { confirmed_sessions: null, unit_price: null, amount: null, confirmed_by: null, confirmed_at: null } }]);
    expect(h.state.tables.invoice_session_terms.find((r) => r.id === "open")).toMatchObject({ confirmed_sessions: null });
    await h.state.after[0]();
    expect(logAction).toHaveBeenCalledWith(expect.objectContaining({ action: "session_term_unconfirm_class", metadata: expect.objectContaining({ classId: CLASS, unconfirmedCount: 2, skipped: 1, items: [
      { termId: "term", sessionsBefore: 8, unitPriceBefore: 40875, amountBefore: 327000, pricingMode: "per_session" },
      { termId: "term2", sessionsBefore: 7, unitPriceBefore: 21250, amountBefore: 148750, pricingMode: "per_session" },
    ] }) }));
    // 반·청구월·입력 검증 — 아무것도 안 쓴다.
    h.state.writes = [];
    expect(await unconfirmClassTerms("2026-09", "noclass:반 미지정", ["term"])).toEqual({ error: "반이 지정되지 않았습니다" });
    expect(await unconfirmClassTerms("2026-9", CLASS, ["term"])).toHaveProperty("error");
    expect(await unconfirmClassTerms("2026-09", CLASS, [])).toHaveProperty("error");
    expect(await unconfirmClassTerms("2026-09", CLASS, ["term", "term"])).toHaveProperty("error");
    expect(h.state.writes).toEqual([]);
    // 한 명이 막히면 그 사람만 골라내고 나머지는 해제한다.
    for (const r of h.state.tables.invoice_session_terms) Object.assign(r, { confirmed_sessions: 7, unit_price: 21250, amount: 148750 });
    h.state.failIds = ["term2"];
    expect(await unconfirmClassTerms("2026-09", CLASS, ["term", "term2"])).toMatchObject({ unconfirmed: 1, failedIds: ["term2"], error: expect.stringContaining("1명은 해제하지 못했습니다") });
  });

  it("선택 일괄 확정 — 화면이 본 단위가 서버 판정과 다르면 그 행은 쓰지 않는다(낡은 화면의 월 금액 × 시수 방지)", async () => {
    const CLASS = "00000000-0000-4000-8000-000000000001";
    Object.assign(h.state.tables.invoice_session_terms[0], { confirmed_sessions: null, unit_price: null, amount: null, confirmed_at: null });
    const res = await confirmSelectedTerms("2026-09", CLASS, [{ id: "term", sessions: 12, unitPrice: 290000, monthly: true }]);
    expect(res).toMatchObject({ confirmed: 0, failedIds: ["term"], error: expect.stringContaining("수강료 방식이 바뀌었습니다") });
    expect(h.state.writes).toEqual([]);
  });

  it("선택 일괄 확정 — 한 명이 DB 규칙에 걸려도 나머지는 확정하고, 걸린 사람과 한글 사유를 돌려준다", async () => {
    const CLASS = "00000000-0000-4000-8000-000000000001";
    const open = { confirmed_sessions: null, unit_price: null, amount: null, confirmed_at: null };
    Object.assign(h.state.tables.invoice_session_terms[0], open);
    h.state.tables.invoice_session_terms.push({ ...h.state.tables.invoice_session_terms[0], id: "term2" }, { ...h.state.tables.invoice_session_terms[0], id: "term3" });
    h.state.failIds = ["term2"];
    const res = await confirmSelectedTerms("2026-09", CLASS, ["term", "term2", "term3"].map((id) => ({ id, sessions: 0, unitPrice: 24000, monthly: false })));
    expect(res).toMatchObject({ confirmed: 2, skipped: 0, failedIds: ["term2"], error: expect.stringContaining("배분금액이 있는 반은 0시수로") });
    expect(res.terms!.map((t) => t.id).sort()).toEqual(["term", "term3"]);
    expect(h.state.tables.invoice_session_terms.find((r) => r.id === "term2")!.confirmed_sessions).toBeNull();
    await h.state.after[0]();
    expect(logAction).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ confirmedCount: 2, failedCount: 1 }) }));
  });

  it("휴원·반 비활성 수강이 섞인 행은 예정이 불확실하다고 표시한다(확정≠예정 표시를 끈다)", async () => {
    h.state.tables.enrollments = [{ student_id: "student", class_id: "class", start_date: "2026-01-01", end_date: null, attendance_days: [], on_hold: true, is_transferred: false, class: { subject: "english", is_active: true } }];
    h.state.tables.class_schedules = [{ class_id: "class", day_of_week: "tue", start_time: "16:00", end_time: "16:55", valid_from: "2026-01-01", valid_to: null, slot_teacher_label: null }];
    expect((await getSessionTermsView("2026-09")).rows[0]).toMatchObject({ plannedSessions: 0, confirmedSessions: 8, planUncertain: true });
    h.state.tables.enrollments[0].on_hold = false;
    expect((await getSessionTermsView("2026-09")).rows[0]).toMatchObject({ planUncertain: false });
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

describe("회차 확정 줄 = 월별 출석부 줄(원장 2026-09-18 \"행 개수가 서로 유기적으로 일치\")", () => {
  const enrolled = (student: string, klass: string, subject = "english") => ({ student_id: student, class_id: klass, start_date: "2026-01-01", end_date: null, on_hold: false, attendance_days: null, is_transferred: false, class: { subject, is_active: true } });

  it("줄 집합에 있는데 회차 행이 없는 쌍은 가상 행 — 청구서 있음=회차 없음 · 없음=청구서 없음 · 취소=청구서 취소 · 줄 밖 회차 행=이번 달 수업 없음", async () => {
    h.state.tables.classes = [
      { id: "class", class_name: "영어반", subject: "english", english_track: "injaewon" },
      { id: "class2", class_name: "수학반", subject: "math", english_track: null },
    ];
    h.state.tables.invoices = [
      { id: "invoice", student_id: "student", line_items: [] },
      { id: "inv-void", student_id: "voided", line_items: [], status: "void" },
      { id: "inv-visit", student_id: "visitor", line_items: [] },
    ];
    h.state.tables.students = [
      { id: "student", name: "학생", grade: "중1" },
      { id: "voided", name: "취소생", grade: "중1" },
      { id: "nobill", name: "무청구", grade: "중1" },
      { id: "visitor", name: "보강생", grade: "중1" },
    ];
    h.state.tables.enrollments = [enrolled("student", "class"), enrolled("student", "class2", "math"), enrolled("voided", "class"), enrolled("nobill", "class")];
    h.state.tables.attendance_records = [{ student_id: "visitor", class_id: "class2", session_date: "2026-09-06", slot_start: null, status: "makeup", session_units: 1.5 }];
    h.state.tables.invoice_session_terms.push({ ...h.state.tables.invoice_session_terms[0], id: "ended", class_id: "class3", class: { class_name: "종강반" } });

    const view = await getSessionTermsView("2026-09");
    const byId = new Map(view.rows.map((r) => [r.id, r]));
    expect(byId.get("term")).toMatchObject({ termState: "term", noLesson: false, invoiceId: "invoice" });
    expect(byId.get("ended")).toMatchObject({ termState: "term", noLesson: true });
    expect(byId.get("v:student:class2")).toMatchObject({ termState: "missing", invoiceId: "invoice", plannedSessions: 0, confirmedSessions: null, className: "수학반" });
    // 수강행 없는 보강 방문 — 예정 없음(null)·실제 시수만.
    expect(byId.get("v:visitor:class2")).toMatchObject({ termState: "missing", invoiceId: "inv-visit", plannedSessions: null, recordedUnits: 1.5, rosterSources: ["recorded"] });
    expect(byId.get("v:voided:class")).toMatchObject({ termState: "void_invoice", invoiceId: null });
    expect(byId.get("v:nobill:class")).toMatchObject({ termState: "no_invoice", invoiceId: null, studentName: "무청구" });
    expect(view).toMatchObject({ invoiceCount: 2, missingCount: 2, noInvoiceCount: 1, voidInvoiceCount: 1, noLessonCount: 1 });
    // 🔴 조회만으로는 아무 행도 만들지 않는다.
    expect(h.state.writes).toEqual([]);
  });

  it("🔴 계획 갱신은 줄 집합 안의 행(보강 방문으로 만든 행)을 지우지 않고 예정도 0으로 덮지 않는다 — 줄 밖 행만 지운다", async () => {
    h.state.tables.classes = [{ id: "class", class_name: "영어반", subject: "english" }, { id: "class2", class_name: "수학반", subject: "math" }, { id: "class3", class_name: "수학반3", subject: "math" }];
    h.state.tables.attendance_records = [
      { student_id: "student", class_id: "class2", session_date: "2026-09-06", slot_start: null, status: "makeup", session_units: 1.5 },
      { student_id: "student", class_id: "class3", session_date: "2026-09-07", slot_start: null, status: "present", session_units: 1 },
    ];
    h.state.tables.invoice_session_terms = [
      { id: "visit", invoice_id: "invoice", class_id: "class2", subject: "math", planned_sessions: null, confirmed_sessions: null, allocation_line_index: null, note: null },
      // 수강행을 지워 방문 줄로 바뀐 행 — 옛 예정 8을 들고 있다 → null로 비운다(반 일괄이 8시수로 확정하지 않게).
      { id: "was-enrolled", invoice_id: "invoice", class_id: "class3", subject: "math", planned_sessions: 8, confirmed_sessions: 5, allocation_line_index: null, note: null },
      { id: "gone", invoice_id: "invoice", class_id: "class", subject: "english", planned_sessions: 9, confirmed_sessions: null, allocation_line_index: null, note: null },
    ];
    expect(await refreshPlannedTerms("2026-09")).toMatchObject({ ok: true });
    expect(logAction).toHaveBeenCalledWith(expect.objectContaining({ action: "session_terms_refresh", metadata: expect.objectContaining({ removed: 1 }) }));
    expect(h.state.tables.invoice_session_terms.find((r) => r.id === "visit")).toMatchObject({ planned_sessions: null });
    expect(h.state.tables.invoice_session_terms.find((r) => r.id === "gone")).toMatchObject({ planned_sessions: 0 });
    // 확정값은 그대로 두고 예정만 비운다.
    expect(h.state.tables.invoice_session_terms.find((r) => r.id === "was-enrolled")).toMatchObject({ planned_sessions: null, confirmed_sessions: 5 });
  });

  it("🔴 반 일괄 확정은 보강 방문 줄(예정 없음)을 빼고 그 수를 돌려준다 — 한 번 온 보강생을 반 전체 시수로 확정하지 않는다", async () => {
    h.state.tables.classes = [{ id: "class2", class_name: "수학반", subject: "math", english_track: null }];
    h.state.tables.invoice_session_terms = [
      { id: "ta", invoice_id: "invoice", class_id: "class2", subject: "math", planned_sessions: 8, confirmed_sessions: null, invoice: { period: "2026-09", student_id: "student" } },
      { id: "tv", invoice_id: "inv-visit", class_id: "class2", subject: "math", planned_sessions: null, confirmed_sessions: null, invoice: { period: "2026-09", student_id: "visitor" } },
    ];
    h.state.tables.invoice_session_terms.push({ id: "t0", invoice_id: "inv-left", class_id: "class2", subject: "math", planned_sessions: 0, confirmed_sessions: null, invoice: { period: "2026-09", student_id: "left" } });
    // 수강 학생만 예정이 있다 — 방문자(visitor)·떠난 학생(left)은 live plan 0. 떠난 학생의 저장값이 0이든 8이든 판정은 live plan이다.
    seedPlan([["student", "class2", "math"]]);
    h.state.tables.invoice_session_terms.find((r) => r.id === "tv")!.planned_sessions = 8;
    const res = await confirmClassTerms("2026-09", "class2", 30000, 8);
    // 예정 없는 방문 줄(tv)도, 예정 0인 떠난 학생 줄(t0)도 빠진다 — 두 명.
    expect(res).toMatchObject({ confirmed: 1, skippedUnplanned: 2 });
    expect(res.terms!.map((t) => t.id)).toEqual(["ta"]);
    expect(h.state.tables.invoice_session_terms.find((r) => r.id === "tv")).toMatchObject({ confirmed_sessions: null });
    expect(h.state.tables.invoice_session_terms.find((r) => r.id === "t0")).toMatchObject({ confirmed_sessions: null });
  });

  it("가상 줄 개별 확정 — 서버가 행을 만들고(감사로그 session_term_create) 그 실 id로 확정한다", async () => {
    const U1 = "11111111-1111-4111-8111-111111111111";
    const UC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    h.state.tables.classes = [{ id: UC, class_name: "수학반", subject: "math", english_track: null }];
    h.state.tables.enrollments = [enrolled(U1, UC, "math")];
    h.state.tables.invoices = [{ id: "inv-u", student_id: U1, line_items: [], status: "issued" }];
    h.state.tables.invoice_session_terms = [];
    const fd = new FormData();
    fd.set("id", `v:${U1}:${UC}`); fd.set("period", "2026-09"); fd.set("sessions", "8"); fd.set("unitPrice", "30000");
    const res = await confirmSessionTerm(undefined, fd);
    expect(res).toMatchObject({ ok: true, created: 1, terms: [{ id: "made-1", confirmedSessions: 8, unitPrice: 30000, amount: 240000 }] });
    expect(h.state.writes[0]).toEqual({ table: "invoice_session_terms", patch: { tenant_id: "tenant", invoice_id: "inv-u", subject: "math", class_id: UC, planned_sessions: 0 } });
    for (const fn of h.state.after) await fn();
    expect(logAction).toHaveBeenCalledWith(expect.objectContaining({ action: "session_term_create", metadata: expect.objectContaining({ reason: "confirm", classId: UC, studentId: U1 }) }));
    expect(logAction).toHaveBeenCalledWith(expect.objectContaining({ action: "session_term_confirm" }));
  });

  it("가상 줄은 청구월이 없으면 거절하고, 해제·이월·메모는 uuid 열에 보내지 않는다", async () => {
    const vid = "v:11111111-1111-4111-8111-111111111111:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const fd = new FormData(); fd.set("id", vid); fd.set("sessions", "8"); fd.set("unitPrice", "30000");
    expect(await confirmSessionTerm(undefined, fd)).toMatchObject({ error: "청구월 형식이 올바르지 않습니다" });
    const un = new FormData(); un.set("id", vid);
    expect(await unconfirmSessionTerm(undefined, un)).toMatchObject({ error: expect.stringContaining("아직 회차 행이 없는 줄") });
    expect(await updateSessionTermNote(vid, "메모")).toMatchObject({ error: expect.stringContaining("아직 회차 행이 없는 줄") });
    expect(h.state.writes).toEqual([]);
  });
});
