import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteSessionTerm, getSessionTermDeletePreview } from "./delete-actions";
import { logAction } from "@/features/audit/server/log";
import { revalidatePath } from "next/cache";

const h = vi.hoisted(() => {
  const state = {
    user: { tenantId: "tenant", systemRole: "master" } as { tenantId: string; systemRole: string } | null,
    canWrite: true,
    results: [] as { data: unknown; error: unknown }[],
    calls: [] as { table: string; methods: [string, ...unknown[]][] }[],
    after: [] as (() => Promise<void>)[],
  };
  const db = {
    from(table: string) {
      const call = { table, methods: [] as [string, ...unknown[]][] };
      state.calls.push(call);
      const query: Record<string, unknown> = {};
      for (const method of ["select", "eq", "gt", "or", "delete", "limit", "maybeSingle"]) {
        query[method] = (...args: unknown[]) => { call.methods.push([method, ...args]); return query; };
      }
      query.then = (resolve: (value: unknown) => void) => resolve(state.results.shift() ?? { data: null, error: null });
      return query;
    },
  };
  return { state, db };
});
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => h.state.user }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canWriteTenant: async () => h.state.canWrite }));
vi.mock("./module-gate", () => ({ SESSION_BILLING_OFF: "off", sessionBillingOff: async () => false }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => h.db }));
vi.mock("@/features/audit/server/log", () => ({ logAction: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: (f: () => Promise<void>) => h.state.after.push(f) }));

const ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const AT = "2026-09-22T01:02:03.123456+00:00";
const term = (patch: Record<string, unknown> = {}) => ({
  id: ID, invoice_id: "invoice", class_id: "class", updated_at: AT,
  confirmed_sessions: 0, unit_price: 24000, amount: 0, planned_sessions: 0, pricing_mode: "per_session", note: "종료반 정리",
  allocation_amount: 0, allocation_line_index: null, allocation_carry_out: 0, carryover_in: 0, carryover_out: 0,
  invoice: { period: "2026-09", student_id: "student" }, ...patch,
});
const enqueue = (data: unknown, error: unknown = null) => h.state.results.push({ data, error });
const deletionCalls = () => h.state.calls.filter((c) => c.methods.some(([m]) => m === "delete"));

beforeEach(() => {
  vi.clearAllMocks();
  h.state.user = { tenantId: "tenant", systemRole: "master" };
  h.state.canWrite = true;
  h.state.results = []; h.state.calls = []; h.state.after = [];
});

describe("회차 삭제 — 서버 방어", () => {
  it.each(["logged-out", "readonly"])("%s는 조회·삭제 모두 DB에 접근하지 않는다", async (mode) => {
    if (mode === "logged-out") h.state.user = null;
    else h.state.canWrite = false;
    expect(await getSessionTermDeletePreview(ID, "2026-09")).toHaveProperty("error");
    expect(await deleteSessionTerm(ID, "2026-09", AT)).toHaveProperty("error");
    expect(h.state.calls).toHaveLength(0);
  });

  it.each(["", "v:student:class", "invalid-uuid", null])("잘못된 대상 %s를 DB에 보내지 않는다", async (id) => {
    expect(await deleteSessionTerm(id as string, "2026-09", AT)).toHaveProperty("error");
    expect(h.state.calls).toHaveLength(0);
  });

  it.each(["2026-13", "2026-9", null])("잘못된 월 %s를 거부한다", async (period) => {
    expect(await getSessionTermDeletePreview(ID, period as string)).toHaveProperty("error");
    expect(h.state.calls).toHaveLength(0);
  });

  it("다른 학원·다른 월·없는 행은 삭제하지 않는다", async () => {
    enqueue(null);
    expect(await deleteSessionTerm(ID, "2026-09", AT)).toHaveProperty("error");
    expect(h.state.calls[0].methods).toEqual(expect.arrayContaining([
      ["eq", "tenant_id", "tenant"], ["eq", "id", ID], ["eq", "invoice.period", "2026-09"],
    ]));
    expect(deletionCalls()).toHaveLength(0);
  });

  it.each([10000, "10000", -1])("저장된 배분 %s원은 유효/환불 상태와 무관하게 보존한다", async (amount) => {
    enqueue(term({ allocation_amount: amount }));
    expect(await deleteSessionTerm(ID, "2026-09", AT)).toMatchObject({ error: expect.stringContaining("배분금") });
    expect(deletionCalls()).toHaveLength(0);
  });

  it.each(["allocation_carry_out", "carryover_in", "carryover_out"])("%s 이월 근거를 보존한다", async (column) => {
    enqueue(term({ [column]: 1 }));
    expect(await deleteSessionTerm(ID, "2026-09", AT)).toMatchObject({ error: expect.stringContaining("이월") });
    expect(deletionCalls()).toHaveLength(0);
  });

  it("지난 달에서 받은 이월도 확인하며 조회 실패 시 삭제를 막는다", async () => {
    enqueue(term()); enqueue([{ id: "source" }]);
    expect(await getSessionTermDeletePreview(ID, "2026-09")).toMatchObject({ preview: { blockedReason: expect.stringContaining("지난 달") } });
    expect(h.state.calls[1].methods).toEqual(expect.arrayContaining([
      ["eq", "tenant_id", "tenant"], ["eq", "allocation_carry_class_id", "class"],
      ["eq", "invoice.period", "2026-08"], ["eq", "invoice.student_id", "student"],
    ]));
    enqueue(term()); enqueue(null, { message: "failed" });
    expect(await deleteSessionTerm(ID, "2026-09", AT)).toMatchObject({ error: expect.stringContaining("확인하지 못했습니다") });
    expect(deletionCalls()).toHaveLength(0);
  });

  it("확인창을 연 뒤 수정된 행은 지우지 않는다", async () => {
    enqueue(term({ updated_at: "new-version" })); enqueue([]);
    expect(await deleteSessionTerm(ID, "2026-09", AT)).toMatchObject({ error: expect.stringContaining("변경") });
    expect(deletionCalls()).toHaveLength(0);
  });

  it("DELETE 직전 경쟁 수정·이미 삭제된 행은 성공으로 표시하지 않는다", async () => {
    enqueue(term()); enqueue([]); enqueue(null);
    expect(await deleteSessionTerm(ID, "2026-09", AT)).toMatchObject({ error: expect.stringContaining("변경") });
    expect(deletionCalls()[0].methods).toEqual(expect.arrayContaining([
      ["eq", "updated_at", AT], ["or", "allocation_amount.is.null,allocation_amount.eq.0"],
      ["eq", "allocation_carry_out", 0], ["eq", "carryover_in", 0], ["eq", "carryover_out", 0],
      ["select", "id"], ["maybeSingle"],
    ]));
    expect(h.state.after).toHaveLength(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("0원 확정·0원 연결 행 삭제는 허용하고 삭제 전 값·메모를 남긴다", async () => {
    enqueue(term({ allocation_line_index: 0 })); enqueue([]);
    const preview = await getSessionTermDeletePreview(ID, "2026-09");
    expect(preview.preview).toEqual({ updatedAt: AT, confirmedSessions: 0, amount: 0, note: "종료반 정리", blockedReason: null });
    enqueue(term({ allocation_line_index: 0 })); enqueue([]); enqueue({ id: ID });
    expect(await deleteSessionTerm(ID, "2026-09", preview.preview!.updatedAt)).toEqual({ ok: true });
    await Promise.all(h.state.after.map((f) => f()));
    expect(logAction).toHaveBeenCalledWith(expect.objectContaining({
      action: "session_term_delete", metadata: expect.objectContaining({ termId: ID, studentId: "student", sessionsBefore: 0, unitPriceBefore: 24000, amountBefore: 0, note: "종료반 정리", allocationAmount: 0, allocationLineIndex: 0 }),
    }));
    expect(revalidatePath).toHaveBeenCalledWith("/billing");
    expect(revalidatePath).toHaveBeenCalledWith("/attendance");
    expect(revalidatePath).toHaveBeenCalledWith("/payroll");
    expect(h.state.calls.every((c) => c.table === "invoice_session_terms")).toBe(true);
    expect(deletionCalls()[0].methods).toContainEqual(["eq", "tenant_id", "tenant"]);
  });

  it("확인창 이후 권한이 회수되면 삭제하지 않는다", async () => {
    enqueue(term()); enqueue([]);
    await getSessionTermDeletePreview(ID, "2026-09");
    h.state.canWrite = false;
    expect(await deleteSessionTerm(ID, "2026-09", AT)).toHaveProperty("error");
    expect(deletionCalls()).toHaveLength(0);
  });

  it("DB 오류 원문을 화면에 내보내지 않는다", async () => {
    enqueue(term()); enqueue([]); enqueue(null, { message: "secret database detail" });
    const result = await deleteSessionTerm(ID, "2026-09", AT);
    expect(result.error).toContain("삭제하지 못했습니다");
    expect(result.error).not.toContain("secret");
    expect(h.state.after).toHaveLength(0);
  });
});
