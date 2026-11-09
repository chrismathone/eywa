import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MoneyCarryIn } from "../money-carryover";

// 금액 이월 → 확정 시수 자동 반영(원장 2026-10-07)의 **서버 배선** — 판정(순수 함수)은 carry-session-sync.test.ts가 본다.
// 여기는: 받은 이월이 없는 학생은 건드리지 않는다 · 배분이 자동으로 다시 확정될 청구서만 고친다 · 읽은 값 그대로일 때만 저장한다 ·
// 고친 뒤 배분 자동 재확정을 부르고 못 했으면 되돌린다 · 내리지 않고 알린다 · 어떤 실패도 삼킨다.
// 받을 줄 고르기는 **실제 함수**(`attachMoneyCarry` — 회차 확정 화면과 같은 것)를 그대로 쓴다.
const h = vi.hoisted(() => ({
  view: vi.fn(), outs: vi.fn(), ins: vi.fn(), autos: vi.fn(), realloc: vi.fn(), log: vi.fn(),
  updates: [] as { values: Record<string, unknown>; filters: Record<string, unknown> }[],
  updateResult: { data: { id: "t1" }, error: null } as { data: unknown; error: unknown },
  /** 쓰기 응답을 차례로 주고 싶을 때(앞에서부터 하나씩) — 비면 `updateResult`. */
  updateQueue: [] as { data: unknown; error: unknown }[],
  invoices: [] as { id: string; period: string; student_id: string; status: string | null }[],
}));
vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: (fn: () => unknown) => { void fn(); } }));
vi.mock("@/features/audit/server/log", () => ({ logAction: h.log }));
vi.mock("./queries", () => ({ getSessionTermsView: h.view }));
vi.mock("./money-carryover-queries", () => ({ loadMoneyCarryOuts: h.outs, loadMoneyCarryIns: h.ins }));
vi.mock("./auto-reallocate", () => ({ loadAutoInvoices: h.autos, autoReallocateAfterConfirm: h.realloc }));

import { applyCarrySync, carryChainBreakNotice, carryShortNotice, carrySyncNotice, lowerConfirmedForCarry, syncCarrySessionsAfter, syncCarrySessionsAfterCarry } from "./carry-session-sync";

const T1 = "aaaaaaaa-1111-4111-8111-111111111111";
const T2 = "aaaaaaaa-2222-4222-8222-222222222222";
const INV = "bbbbbbbb-2222-4222-8222-222222222222";
const STUDENT = "cccccccc-3333-4333-8333-333333333333";
const CLASS = "dddddddd-4444-4444-8444-444444444444";
const CLASS2 = "dddddddd-5555-4555-8555-555555555555";
const KEY = `${STUDENT}|${CLASS}`;
const carryIn = (amount: number, over: Partial<MoneyCarryIn> = {}): MoneyCarryIn => ({ amount, fromPeriod: "2026-08", fromClassName: "중등M 개별", note: null, valid: true, ...over });
/** 원장 캡처의 9월 줄 — 확정 5 · 단가 24,000 · 확정액 120,000 · 배분 120,000. */
const row = (over: Record<string, unknown> = {}) => ({
  id: T1, invoiceId: INV, studentId: STUDENT, studentName: "홍도연", classId: CLASS, className: "중등M 개별 JJ3I", termState: "term",
  pricingMode: "per_session", quantityBasis: "attendance_units", confirmedSessions: 5, unitPrice: 24000, amount: 120000, confirmedAt: "2026-09-01T00:00:00Z",
  allocatedAmount: 120000, allocationStale: false, ...over,
});
const LINE = { kind: "수업", description: "중등M 개별 JJ3I", amount: 120000 };
/** 배분 자동 재확정이 '그대로 다시 저장'으로 판정하는 청구서 — 수납 항목 하나를 이 반 혼자 받는다. */
const autoInvoice = (over: Record<string, unknown> = {}) => new Map([[INV, {
  inv: { id: INV, status: "issued", line_items: [LINE] },
  terms: [{
    id: T1, class_id: CLASS, className: "중등M 개별 JJ3I", subject: "math", amount: 120000, confirmed_sessions: 5, confirmed_at: "2026-09-01T00:00:00Z", pricing_mode: "per_session",
    allocation_line_index: 0, allocation_amount: 120000, allocation_base_amount: 120000,
    allocation_source: LINE, ...over,
  }],
}]]);
const rowsOf = (...rows: Record<string, unknown>[]) => h.view.mockImplementation(async () => ({ rows: rows.map((r) => ({ ...r })) })); // 부를 때마다 새 줄
const carries = (map: Record<string, MoneyCarryIn[]>) => h.ins.mockResolvedValue({ map: new Map(Object.entries(map)), failed: false });

function db() {
  const from = (table: string) => {
    const filters: Record<string, unknown> = {};
    let values: Record<string, unknown> | null = null;
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.neq = () => builder;
    builder.order = () => builder;
    builder.in = () => builder;
    builder.eq = (col: string, v: unknown) => { filters[col] = v; return builder; };
    builder.update = (v: Record<string, unknown>) => { values = v; return builder; };
    builder.maybeSingle = () => builder;
    builder.then = (resolve: (v: unknown) => unknown) => {
      if (table === "invoices") {
        const list = h.invoices.filter((i) => (filters.id ? i.id === filters.id : i.period === filters.period && i.student_id === filters.student_id));
        return Promise.resolve({ data: filters.id ? list[0] ?? null : list, error: null }).then(resolve);
      }
      if (values) { h.updates.push({ values, filters }); return Promise.resolve(h.updateQueue.shift() ?? h.updateResult).then(resolve); }
      // 회차 행 조회 둘: 방금 확정한 줄들의 청구서 · 고칠 줄의 종전 확정자.
      return Promise.resolve({ data: [...h.invoices.map((invoice) => ({ invoice, id: T1, confirmed_by: "owner-1" }))], error: null }).then(resolve);
    };
    return builder;
  };
  return { from } as never;
}

beforeEach(() => {
  vi.clearAllMocks(); h.updates = []; h.updateQueue = []; h.updateResult = { data: { id: T1 }, error: null };
  h.invoices = [{ id: INV, period: "2026-09", student_id: STUDENT, status: "issued" }];
  rowsOf(row());
  h.outs.mockResolvedValue({ map: new Map(), failed: false });
  carries({ [KEY]: [carryIn(24000)] });
  h.autos.mockResolvedValue(autoInvoice());
  h.realloc.mockResolvedValue({ saved: 1, skipped: 0 });
});

describe("확정·배분 저장 뒤 — 받은 이월이 실린 줄의 확정 시수를 올린다", () => {
  it("원장 캡처 — 확정 5 → 6 · 확정액 144,000으로 고치고 배분 자동 재확정을 부른다", async () => {
    const changes = await syncCarrySessionsAfter(db(), { termIds: [T1] }, "user-1", "confirm");
    expect(changes).toEqual([expect.objectContaining({ termId: T1, sessionsBefore: 5, sessions: 6, amountBefore: 120000, amount: 144000, byAmount: 24000, unitPrice: 24000 })]);
    expect(h.updates).toHaveLength(1);
    expect(h.updates[0]!.values).toMatchObject({ confirmed_sessions: 6, amount: 144000, confirmed_by: "user-1" });
    // 🔴 읽은 값 그대로일 때만 — 그 사이 누가 확정을 풀거나 고쳤으면 저장되지 않는다.
    expect(h.updates[0]!.filters).toMatchObject({ id: T1, confirmed_sessions: 5, amount: 120000, unit_price: 24000 });
    expect(h.realloc).toHaveBeenCalledWith(expect.anything(), [T1], "carry_sync:confirm");
    expect(h.log).toHaveBeenCalledWith(expect.objectContaining({ action: "session_term_carry_sync", metadata: expect.objectContaining({ sessionsBefore: 5, sessions: 6, carryAmount: 24000, trigger: "confirm" }) }));
    expect(carrySyncNotice(changes)).toBe("9월 홍도연 중등M 개별 JJ3I: 확정 시수 5 → 6(받은 이월 24,000원 반영)");
  });

  it("배분을 저장한 청구서로 불러도 같다", async () => {
    const changes = await syncCarrySessionsAfter(db(), { invoiceId: INV }, "user-1", "allocate");
    expect(changes).toHaveLength(1);
    expect(h.realloc).toHaveBeenCalledWith(expect.anything(), [T1], "carry_sync:allocate");
  });

  it("🔴 받은 이월이 없는 학생은 줄을 읽지도 않는다 — 확정마다 무거운 조회가 돌지 않게", async () => {
    carries({});
    expect(await syncCarrySessionsAfter(db(), { termIds: [T1] }, "user-1", "confirm")).toEqual([]);
    expect(h.view).not.toHaveBeenCalled();
    expect(h.updates).toEqual([]);
  });

  it("🔴 배분이 자동으로 다시 확정되지 않을 청구서는 손대지 않는다 — 맞던 줄을 '재확인' 줄로 바꾸지 않는다", async () => {
    // 수납 항목 하나를 두 반이 나눠 받는 청구서(자동 재확정이 건너뛰는 모양).
    const shared = autoInvoice();
    shared.get(INV)!.terms.push({ ...shared.get(INV)!.terms[0]!, id: T2, class_id: CLASS2, className: "중등M 정규", amount: 60000, allocation_amount: 60000, allocation_base_amount: 60000 });
    shared.get(INV)!.terms[0]!.allocation_amount = 60000;
    h.autos.mockResolvedValue(shared);
    expect(await syncCarrySessionsAfter(db(), { termIds: [T1] }, "user-1", "confirm")).toEqual([]);
    expect(h.updates).toEqual([]);
    expect(h.realloc).not.toHaveBeenCalled();
  });

  it("🔴 고친 뒤 배분 재확정이 실패하면(다른 저장과 겹침) 고친 값을 되돌린다 — 이월이 안 실린 '재확인' 줄로 남기지 않는다", async () => {
    h.realloc.mockResolvedValue({ saved: 0, skipped: 1 });
    expect(await syncCarrySessionsAfter(db(), { termIds: [T1] }, "user-1", "confirm")).toEqual([]);
    expect(h.updates).toHaveLength(2);
    // 되돌리기 — 종전 시수·확정액·확정자·확정 시각으로, **내가 고친 값 그대로일 때만**.
    expect(h.updates[1]!.values).toEqual({ confirmed_sessions: 5, amount: 120000, confirmed_by: "owner-1", confirmed_at: "2026-09-01T00:00:00Z" });
    expect(h.updates[1]!.filters).toMatchObject({ id: T1, confirmed_sessions: 6, amount: 144000 });
    expect(h.log).not.toHaveBeenCalled();
  });

  it("🔴 되돌리기까지 실패하면 숨기지 않는다 — 고친 줄로 알리고 '배분을 다시 저장'하라고 말한다", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.realloc.mockResolvedValue({ saved: 0, skipped: 1 });
    let calls = 0;
    const base = db();
    // 첫 update(올리기)는 성공 · 둘째 update(되돌리기)는 실패.
    const failing = { from: (table: string) => {
      const b = (base as unknown as { from: (t: string) => Record<string, unknown> }).from(table);
      const update = b.update as (v: Record<string, unknown>) => unknown;
      b.update = (v: Record<string, unknown>) => { calls += 1; if (calls === 2) h.updateResult = { data: null, error: { message: "timeout" } }; return update(v); };
      return b;
    } } as never;
    const changes = await syncCarrySessionsAfter(failing, { termIds: [T1] }, "user-1", "confirm");
    expect(changes).toEqual([expect.objectContaining({ termId: T1, sessions: 6, needsAllocation: true })]);
    expect(carrySyncNotice(changes)).toContain("배분을 다시 저장해 주세요");
    expect(h.log).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ needsAllocation: true }) }));
    spy.mockRestore(); warn.mockRestore();
  });

  it("고친 뒤의 줄은 실제 판정으로도 '그대로 다시 저장'이고, 저장되면 이월이 실린 유효 배분이 된다", async () => {
    const { planAutoReallocation } = await import("../auto-reallocation");
    const { invoiceAllocationStates } = await import("../allocation-state");
    const entry = autoInvoice({ amount: 144000, confirmed_sessions: 6 }).get(INV)!; // 확정액만 올린 직후(기준액은 아직 120,000)
    expect(invoiceAllocationStates(entry.inv, entry.terms as never).get(T1)?.allocationStale).toBe(true);
    const plan = planAutoReallocation(entry.inv, entry.terms as never);
    expect(plan).toMatchObject({ kind: "save", rows: [{ termId: T1, lineIndex: 0, amount: 120000, baseAmount: 144000 }] });
    const saved = entry.terms.map((t) => ({ ...t, allocation_base_amount: 144000 }));
    expect(invoiceAllocationStates(entry.inv, saved as never).get(T1)).toMatchObject({ allocationStale: false, allocatedAmount: 120000 });
  });

  it("이미 맞는 줄(사람이 6으로 확정)·이월이 무효인 줄은 그대로", async () => {
    rowsOf(row({ confirmedSessions: 6, amount: 144000 }));
    expect(await syncCarrySessionsAfter(db(), { termIds: [T1] }, "user-1", "confirm")).toEqual([]);
    rowsOf(row());
    carries({ [KEY]: [carryIn(24000, { valid: false })] });
    expect(await syncCarrySessionsAfter(db(), { termIds: [T1] }, "user-1", "confirm")).toEqual([]);
    expect(h.updates).toEqual([]);
  });

  it("🔴 받을 반 줄이 이 달에 없으면(orphan) 그 학생의 다른 줄을 올리지 않는다 — 화면과 같은 함수로 받을 줄을 고른다", async () => {
    // 이월은 CLASS2로 왔는데 이 달엔 CLASS 줄뿐 — 보이게만 붙고 실납엔 안 더해진다.
    carries({ [`${STUDENT}|${CLASS2}`]: [carryIn(24000)] });
    expect(await syncCarrySessionsAfter(db(), { termIds: [T1] }, "user-1", "confirm")).toEqual([]);
    expect(h.updates).toEqual([]);
  });

  it("🔴 같은 학생·반 줄이 둘이면 받을 수 있는 줄 하나에만 붙는다 — 두 줄을 다 올리지 않는다", async () => {
    // T2는 배분이 없는 줄(받을 수 없다) — 이월은 배분이 있는 T1에만 실린다.
    rowsOf(row(), row({ id: T2, allocatedAmount: null }));
    const changes = await syncCarrySessionsAfter(db(), { termIds: [T1] }, "user-1", "confirm");
    expect(changes.map((c) => c.termId)).toEqual([T1]);
    expect(h.updates).toHaveLength(1);
  });

  it("🔴 그 사이 줄이 바뀌었으면(조건부 저장 0행) 고친 것으로 치지 않는다", async () => {
    h.updateResult = { data: null, error: null };
    expect(await syncCarrySessionsAfter(db(), { termIds: [T1] }, "user-1", "confirm")).toEqual([]);
    expect(h.realloc).not.toHaveBeenCalled();
    expect(h.log).not.toHaveBeenCalled();
  });

  it("🔴 이월 조회 실패·예외는 삼킨다 — 부른 일(확정·배분 저장)은 이미 끝났다", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    h.ins.mockResolvedValue({ map: new Map(), failed: true });
    expect(await syncCarrySessionsAfter(db(), { termIds: [T1] }, "user-1", "confirm")).toEqual([]);
    h.ins.mockRejectedValue(new Error("timeout"));
    expect(await syncCarrySessionsAfter(db(), { termIds: [T1] }, "user-1", "confirm")).toEqual([]);
    expect(await syncCarrySessionsAfter(db(), { termIds: ["가상 행"] }, "user-1", "confirm")).toEqual([]);
    spy.mockRestore();
  });

  it("취소된 청구서의 줄은 보지 않는다", async () => {
    h.invoices = [{ id: INV, period: "2026-09", student_id: STUDENT, status: "void" }];
    expect(await syncCarrySessionsAfter(db(), { termIds: [T1] }, "user-1", "confirm")).toEqual([]);
    expect(h.ins).not.toHaveBeenCalled();
  });
});

describe("이월 저장·취소 뒤", () => {
  const args = (over: Record<string, unknown> = {}) => ({ period: "2026-09", studentId: STUDENT, previous: null, next: { classId: CLASS, amount: 24000 }, ...over }) as never;

  it("이월을 새로 저장 — 받는 달 줄이 더 받게 됐으면 올린다", async () => {
    const result = await syncCarrySessionsAfterCarry(db(), args(), "user-1");
    expect(result.changes).toEqual([expect.objectContaining({ sessions: 6, amount: 144000, byAmount: 24000 })]);
    expect(result.shorts).toEqual([]);
    expect(h.realloc).toHaveBeenCalledWith(expect.anything(), [T1], "carry_sync:carry");
  });

  it("🔴 이월 취소 — 자동으로 내리지 않는다. 덜 받게 된 줄을 알리기만 한다", async () => {
    rowsOf(row({ confirmedSessions: 6, amount: 144000 }));
    carries({});
    const result = await syncCarrySessionsAfterCarry(db(), args({ previous: { classId: CLASS, amount: 24000 }, next: null }), "user-1");
    expect(result.changes).toEqual([]);
    expect(h.updates).toEqual([]);
    expect(result.shorts).toEqual([{ termId: T1, period: "2026-09", studentName: "홍도연", className: "중등M 개별 JJ3I", sessions: 6, amount: 144000, shortBy: 24000 }]);
    expect(carryShortNotice(result.shorts)).toBe("9월 홍도연 중등M 개별 JJ3I: 이월이 빠져 실납이 확정액보다 24,000원 적습니다 — 확정 시수 6은(는) 그대로 두었습니다. 회차 확정에서 확인해 주세요.");
  });

  it("🔴 청구가 4회분인데 이월로 부족을 메워 사람이 5로 확정해 둔 줄 — 이월이 빠져도 4로 깎지 않고 알린다", async () => {
    rowsOf(row({ allocatedAmount: 96000 }));
    carries({});
    const result = await syncCarrySessionsAfterCarry(db(), args({ previous: { classId: CLASS, amount: 24000 }, next: null }), "user-1");
    expect(h.updates).toEqual([]);
    expect(result.shorts).toEqual([expect.objectContaining({ sessions: 5, shortBy: 24000 })]);
  });

  it("받을 반을 바꾸면 — 새 반 줄은 올리고, 이월이 빠진 옛 반 줄은 알린다", async () => {
    // 옛 반(CLASS)은 이월로 6이 돼 있었고 이제 이월이 CLASS2로 간다.
    rowsOf(row({ confirmedSessions: 6, amount: 144000 }), row({ id: T2, classId: CLASS2, className: "중등M 정규" }));
    carries({ [`${STUDENT}|${CLASS2}`]: [carryIn(24000)] });
    const both = autoInvoice();
    both.get(INV)!.terms = [{ ...both.get(INV)!.terms[0]!, id: T2, class_id: CLASS2, className: "중등M 개별 JJ3I" }];
    h.autos.mockResolvedValue(both);
    h.updateResult = { data: { id: T2 }, error: null };
    const result = await syncCarrySessionsAfterCarry(db(), args({ previous: { classId: CLASS, amount: 24000 }, next: { classId: CLASS2, amount: 24000 } }), "user-1");
    expect(result.changes.map((c) => c.termId)).toEqual([T2]);
    expect(result.shorts.map((s) => s.termId)).toEqual([T1]);
  });

  it("🔴 이미 올린 줄에 이월이 더 실리면 늘어난 몫만큼 더 올린다 — 사람이 다시 7로 고칠 일이 없다", async () => {
    // 확정 6 · 144,000(이월 24,000 반영 끝)인데 이월을 48,000으로 늘렸다.
    rowsOf(row({ confirmedSessions: 6, amount: 144000 }));
    carries({ [KEY]: [carryIn(48000)] });
    h.autos.mockResolvedValue(autoInvoice({ amount: 144000, confirmed_sessions: 6, allocation_base_amount: 144000 }));
    const result = await syncCarrySessionsAfterCarry(db(), args({ previous: { classId: CLASS, amount: 24000 }, next: { classId: CLASS, amount: 48000 } }), "user-1");
    expect(result.changes).toEqual([expect.objectContaining({ sessionsBefore: 6, sessions: 7, amount: 168000, byAmount: 24000 })]);
    // 확정·배분 저장 계기(늘어난 몫을 모른다)로는 그대로 둔다 — 사람이 넣어 둔 줄과 같은 모양이라.
    h.updates = [];
    expect(await syncCarrySessionsAfter(db(), { termIds: [T1] }, "user-1", "confirm")).toEqual([]);
    expect(h.updates).toEqual([]);
  });

  it("🔴 연쇄 이월이 끊기면 알린다 — 받은 이월이 빠져 다음 달로 넘긴 이월이 무효가 된 줄(그다음 달 실납도 바뀐다, 2026-11-09)", async () => {
    // 9월: 배분 120,000 · 확정 5시수 120,000 · 8월에서 받던 24,000으로 남은 12,000을 10월로 넘겨 두었다 → 8월 이월 취소.
    rowsOf(row());
    carries({});
    h.outs.mockResolvedValue({ map: new Map([[T1, { amount: 12000, toClassId: CLASS, toClassName: "중등M 개별 JJ3I", toPeriod: "2026-10", note: null, at: null }]]), failed: false });
    const result = await syncCarrySessionsAfterCarry(db(), args({ previous: { classId: CLASS, amount: 24000 }, next: null }), "user-1");
    expect(result.shorts).toEqual([]); // 9월 실납 = 확정액(무효가 된 이월은 빼지 않는다)
    expect(result.broken).toEqual([{ period: "2026-09", toPeriod: "2026-10", studentName: "홍도연", className: "중등M 개별 JJ3I", amount: 12000 }]);
    expect(carryChainBreakNotice(result.broken!)).toBe("9월 홍도연 중등M 개별 JJ3I: 받은 이월이 줄어 10월로 넘긴 12,000원 이월이 무효가 되었습니다 — 10월 실납에서도 빠졌으니 9월 이월을 고치거나 취소하고 10월 회차 확정을 확인해 주세요.");
    // 이번 저장 전에도 무효였던 이월(받은 이월을 되돌려도 모자람 — 이미 '이월 재확인')은 이 저장 탓으로 알리지 않는다.
    h.outs.mockResolvedValue({ map: new Map([[T1, { amount: 50000, toClassId: CLASS, toClassName: "중등M 개별 JJ3I", toPeriod: "2026-10", note: null, at: null }]]), failed: false });
    expect((await syncCarrySessionsAfterCarry(db(), args({ previous: { classId: CLASS, amount: 24000 }, next: null }), "user-1")).broken).toBeUndefined();
    h.outs.mockResolvedValue({ map: new Map(), failed: false });
    // 받은 이월이 그대로면(취소가 아니라 새로 저장) 끊긴 줄이 없다 — 반환 모양도 종전 그대로.
    carries({ [KEY]: [carryIn(24000)] });
    expect((await syncCarrySessionsAfterCarry(db(), args(), "user-1")).broken).toBeUndefined();
  });

  it("🔴 원래 덜 받던 줄을 이월 탓으로 말하지 않는다 — 부족분이 빠진 이월보다 크면 알리지 않는다", async () => {
    // 확정액 120,000 · 배분 80,000(원래 4만 원 부족) — 이월 24,000을 취소해도 부족 40,000은 이월 탓이 아니다.
    rowsOf(row({ allocatedAmount: 80000 }));
    carries({});
    const result = await syncCarrySessionsAfterCarry(db(), args({ previous: { classId: CLASS, amount: 24000 }, next: null }), "user-1");
    expect(result.shorts).toEqual([]);
  });

  it("🔴 받을 반이 없던 옛 이월(실린 적이 없다)을 취소해도 반 없는 줄을 알리지 않는다", async () => {
    rowsOf(row({ classId: null, className: null, allocatedAmount: 96000 }));
    carries({});
    const result = await syncCarrySessionsAfterCarry(db(), args({ previous: { classId: null, amount: 24000 }, next: null }), "user-1");
    expect(result.shorts).toEqual([]);
  });

  it("이월을 늘리기만 했거나 처음 저장한 것이면 덜 받은 줄 안내는 없다 · 받는 달 청구서가 없으면 아무 일도 없다", async () => {
    rowsOf(row({ allocatedAmount: 96000 })); // 이월과 무관하게 덜 받은 줄
    const first = await syncCarrySessionsAfterCarry(db(), args(), "user-1");
    expect(first.shorts).toEqual([]);
    const more = await syncCarrySessionsAfterCarry(db(), args({ previous: { classId: CLASS, amount: 12000 }, next: { classId: CLASS, amount: 24000 } }), "user-1");
    expect(more.shorts).toEqual([]);
    h.invoices = [];
    expect(await syncCarrySessionsAfterCarry(db(), args(), "user-1")).toEqual({ changes: [], shorts: [] });
    expect(carryShortNotice([])).toBeUndefined();
    expect(carrySyncNotice([])).toBeUndefined();
  });

  it("실패는 삼킨다", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    h.view.mockRejectedValue(new Error("timeout"));
    expect(await syncCarrySessionsAfterCarry(db(), args(), "user-1")).toEqual({ changes: [], shorts: [] });
    spy.mockRestore();
  });
});

describe("확정 응답 행 패치", () => {
  const patch = { id: T1, confirmedSessions: 5, unitPrice: 24000, amount: 120000, pricingMode: "per_session" as const, confirmedAt: "x", quantityBasis: "attendance_units" as const };
  const change = { termId: T1, period: "2026-09", studentName: "홍도연", className: "중등M 개별 JJ3I", sessionsBefore: 5, sessions: 6, amountBefore: 120000, amount: 144000, unitPrice: 24000, confirmedAt: "y", byAmount: 24000 };

  it("방금 확정한 줄이 고쳐졌으면 그 줄의 값을 바꾸고 안내를 싣는다", () => {
    expect(applyCarrySync([patch], [change])).toEqual([{ ...patch, confirmedSessions: 6, amount: 144000, confirmedAt: "y", carryNotice: "9월 홍도연 중등M 개별 JJ3I: 확정 시수 5 → 6(받은 이월 24,000원 반영)" }]);
    expect(applyCarrySync([patch], [])).toEqual([patch]);
  });

  it("같은 학생의 다른 줄이 고쳐졌으면 패치를 하나 더한다", () => {
    const other = applyCarrySync([patch], [{ ...change, termId: T2 }]);
    expect(other).toHaveLength(2);
    expect(other[1]).toMatchObject({ id: T2, confirmedSessions: 6, amount: 144000, unitPrice: 24000, pricingMode: "per_session" });
  });
});

describe("이월 창 — 받은 이월을 다시 넘기며 확정 시수 낮추기(lowerConfirmedForCarry · 2026-11-09)", () => {
  // 자동으로 6까지 올린 줄(배분 120,000 + 받은 24,000) — 24,000을 다음 달로 넘기며 5로 낮춘다.
  const raised = () => row({ confirmedSessions: 6, amount: 144000, confirmedAt: "2026-10-07T00:00:00Z" }) as never;
  beforeEach(() => { h.autos.mockResolvedValue(autoInvoice({ amount: 144000, confirmed_sessions: 6, allocation_base_amount: 144000 })); });

  it("배분이 자동으로 다시 확정될 때만 · 읽은 값 그대로일 때만 낮추고 배분을 다시 맞춘다", async () => {
    const r = await lowerConfirmedForCarry(db(), raised(), { sessions: 5, amount: 120000 }, "user-1");
    expect(r.ok).toBe(true);
    expect(h.updates).toHaveLength(1);
    expect(h.updates[0]).toMatchObject({ values: { confirmed_sessions: 5, amount: 120000, confirmed_by: "user-1" }, filters: { id: T1, confirmed_sessions: 6, amount: 144000, unit_price: 24000 } });
    expect(h.realloc).toHaveBeenCalledWith(expect.anything(), [T1], "carry_unreflect");
    // 이월 저장이 실패하면 호출부가 되돌린다 — 읽은 값으로 · 배분도 다시.
    expect(r.ok && await r.revert()).toBe("reverted");
    expect(h.updates[1]).toMatchObject({ values: { confirmed_sessions: 6, amount: 144000, confirmed_at: "2026-10-07T00:00:00Z" }, filters: { id: T1, confirmed_sessions: 5, amount: 120000 } });
    expect(h.realloc).toHaveBeenLastCalledWith(expect.anything(), [T1], "carry_unreflect_revert");
  });

  it("배분을 자동으로 다시 맞출 수 없는 청구서면 손대지 않고 이유를 말한다", async () => {
    h.autos.mockResolvedValue(new Map());
    const r = await lowerConfirmedForCarry(db(), raised(), { sessions: 5, amount: 120000 }, "user-1");
    expect(r).toEqual({ ok: false, error: expect.stringContaining("자동으로 다시 맞출 수 없습니다") });
    expect(h.updates).toEqual([]);
  });

  it("그 사이 확정이 바뀌었으면(0행) 저장하지 않는다 · 배분 재확정에 실패하면 되돌린다", async () => {
    h.updateResult = { data: null, error: null };
    expect(await lowerConfirmedForCarry(db(), raised(), { sessions: 5, amount: 120000 }, "user-1")).toMatchObject({ ok: false });
    expect(h.realloc).not.toHaveBeenCalled();
    h.updateResult = { data: { id: T1 }, error: null };
    h.updates = [];
    h.realloc.mockResolvedValueOnce({ saved: 0, skipped: 1 });
    expect(await lowerConfirmedForCarry(db(), raised(), { sessions: 5, amount: 120000 }, "user-1")).toEqual({ ok: false, error: expect.stringContaining("되돌렸습니다") });
    expect(h.updates.map((u) => u.values.confirmed_sessions)).toEqual([5, 6]);
  });

  it("🔴 재확정도 되돌리기도 못하면 숨기지 않는다 — 낮춘 시수로 남았다고 말한다(stuck) · revert 결과도 돌려준다", async () => {
    h.updateQueue = [{ data: { id: T1 }, error: null }, { data: null, error: null }]; // 낮춤 성공 · 되돌림 0행(그 사이 누가 고침)
    h.realloc.mockResolvedValueOnce({ saved: 0, skipped: 1 });
    expect(await lowerConfirmedForCarry(db(), raised(), { sessions: 5, amount: 120000 }, "user-1"))
      .toEqual({ ok: false, stuck: true, error: expect.stringContaining("되돌리지도 못했습니다") });
    // 성공한 낮춤의 revert — 되돌림 0행이면 stuck(호출부가 '낮춘 시수로 남음'을 알린다) · 되돌렸지만 재확정 실패면 따로 구분.
    h.updates = [];
    h.updateQueue = [{ data: { id: T1 }, error: null }, { data: null, error: null }];
    const r = await lowerConfirmedForCarry(db(), raised(), { sessions: 5, amount: 120000 }, "user-1");
    expect(r.ok && await r.revert()).toBe("stuck");
    const r2 = await lowerConfirmedForCarry(db(), raised(), { sessions: 5, amount: 120000 }, "user-1");
    h.realloc.mockResolvedValueOnce({ saved: 0, skipped: 1 });
    expect(r2.ok && await r2.revert()).toBe("reverted_needs_allocation");
    // 낮춤 뒤 배분 재확정 실패 + 시수는 되돌림 → stuck 아님(배분만 다시 저장하라고 말한다).
    h.realloc.mockResolvedValueOnce({ saved: 0, skipped: 1 }).mockResolvedValueOnce({ saved: 0, skipped: 1 });
    expect(await lowerConfirmedForCarry(db(), raised(), { sessions: 5, amount: 120000 }, "user-1"))
      .toEqual({ ok: false, error: expect.stringContaining("되돌렸지만 수납 배분을 다시 맞추지 못했습니다") });
  });
});
