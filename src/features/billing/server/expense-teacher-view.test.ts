// 지출결의서 — '다른 강사 뷰'(원장 A가 강사 X 화면)에서 X 명의로 작성·조회·수정된다(원장 2026-11-05 강사뷰 전수).
// 쓰기는 세션 먼저(실제 계정 A의 RLS — 활동 기록의 행위자가 auth.uid()), RLS에 막힐 때만 관리 클라이언트(teacher-view-db.ts).
// 강사뷰 조회는 관리 클라이언트 + tenant_id 명시 + RLS(0158a)와 같은 열람 규칙을 X 기준으로 앱에서(적대 리뷰 2026-11-05).
import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { client: "session" | "admin"; op: string; args: unknown[] };

const m = vi.hoisted(() => ({
  user: vi.fn(),
  canWrite: vi.fn(),
  canAccess: vi.fn(),
  viewAs: vi.fn(),
  log: vi.fn(),
  calls: [] as Call[],
  row: null as Record<string, unknown> | null,
  list: [] as unknown[],
  /** 세션 쓰기의 RLS 흉내 — insert 에러 · update/delete 반환 행. */
  sessionInsertError: null as { code: string; message: string } | null,
  sessionMutateRows: [{ id: "e1" }] as unknown[],
}));

function client(kind: "session" | "admin") {
  return {
    from: () => {
      const q: Record<string, unknown> = {};
      let op = "select";
      for (const k of ["select", "eq", "insert", "update", "delete", "order", "limit"]) {
        q[k] = (...args: unknown[]) => {
          if (k === "insert" || k === "update" || k === "delete") op = k;
          m.calls.push({ client: kind, op: k, args });
          return q;
        };
      }
      q.maybeSingle = async () => {
        if (op === "insert") return kind === "session" && m.sessionInsertError ? { data: null, error: m.sessionInsertError } : { data: { id: "new" }, error: null };
        return { data: m.row, error: null };
      };
      q.then = (res: (v: unknown) => unknown) => {
        if (op === "update" || op === "delete") return Promise.resolve({ data: kind === "session" ? m.sessionMutateRows : [{ id: "e1" }], error: null }).then(res);
        return Promise.resolve({ data: m.list, error: null }).then(res);
      };
      return q;
    },
  };
}

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canWriteTenant: m.canWrite, canAccessTenant: m.canAccess }));
vi.mock("@/lib/auth/view-as", () => ({ viewAsTeacher: m.viewAs }));
vi.mock("@/features/audit/server/log", () => ({ logAction: m.log }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => client("session") }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => client("admin") }));
vi.mock("@/lib/storage/media-storage", () => ({
  resolveTenantReadUrl: async () => "signed://one",
  resolveTenantReadUrls: async (paths: string[]) => Object.fromEntries(paths.map((p) => [p, `signed://${p}`])),
  issueTenantUploadTicket: vi.fn(),
  removeTenantObjects: vi.fn(),
  verifyTenantUpload: vi.fn(),
}));

import { createExpense, signExpenseReceipts, updateExpense } from "./expense-actions";
import { getExpenseById, getMyExpenseRequests } from "./expense-queries";

const A = { id: "a1", tenantId: "t1", systemRole: "master", displayName: "원장" };
const X = { id: "x1", tenantId: "t1", systemRole: "teacher", displayName: "김선생" };
const EXPENSE_ID = "11111111-1111-4111-8111-111111111111";
const RECEIPT = `t1/${EXPENSE_ID}/a.png`;
const writes = () => m.calls.filter((c) => ["insert", "update", "delete"].includes(c.op));
const tenantEqs = (client: "session" | "admin") =>
  m.calls.filter((c) => c.client === client && c.op === "eq" && c.args[0] === "tenant_id" && c.args[1] === "t1").length;

beforeEach(() => {
  vi.clearAllMocks();
  m.calls = [];
  m.list = [];
  m.sessionInsertError = null;
  m.sessionMutateRows = [{ id: "e1" }];
  m.user.mockImplementation(async (o?: { teacherView?: boolean }) => (o?.teacherView ? X : A));
  // X(강사)는 지출결의서 own 범위 — billing 쓰기는 없고 expense_requests 쓰기만 있다.
  m.canWrite.mockImplementation(async (_role: string, menu: string) => menu === "expense_requests");
  m.canAccess.mockResolvedValue(false);
  m.viewAs.mockResolvedValue({ ...X, access: "full" });
  m.row = { created_by: "x1", approval_checks: {}, receipt_urls: [{ path: RECEIPT, name: "a.png" }] };
});

function expenseForm(extra: Record<string, string> = {}) {
  const fd = new FormData();
  fd.set("title", "교재 구입");
  fd.set("amount", "10000");
  fd.set("expenseDate", "2026-11-05");
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return fd;
}

describe("지출결의서 — 강사뷰 신원 · 세션 먼저", () => {
  it("🔴 작성은 X 명의(created_by·작성자) — A의 세션이 통과하면(원장 = 수납 쓰기) 세션으로 쓴다", async () => {
    expect(await createExpense(undefined, expenseForm())).toEqual({ ok: true });
    const inserts = m.calls.filter((c) => c.op === "insert");
    expect(inserts.map((c) => c.client)).toEqual(["session"]);
    expect(inserts[0]!.args[0]).toMatchObject({ tenant_id: "t1", created_by: "x1", author: "김선생" });
  });

  it("🔴 A의 세션이 RLS(42501)에 막히면 그때만 관리 클라이언트로 같은 행을 다시 쓴다", async () => {
    m.sessionInsertError = { code: "42501", message: "new row violates row-level security policy" };
    expect(await createExpense(undefined, expenseForm())).toEqual({ ok: true });
    const inserts = m.calls.filter((c) => c.op === "insert");
    expect(inserts.map((c) => c.client)).toEqual(["session", "admin"]);
    expect(inserts[1]!.args[0]).toMatchObject({ tenant_id: "t1", created_by: "x1" });
  });

  it("강사뷰가 아니면 세션 그대로 — 막혀도 관리 클라이언트로 내려가지 않는다", async () => {
    m.viewAs.mockResolvedValue(null);
    m.user.mockResolvedValue(A);
    m.canWrite.mockResolvedValue(true);
    m.sessionInsertError = { code: "42501", message: "rls" };
    expect((await createExpense(undefined, expenseForm()))?.error).toBe("rls");
    expect(m.calls.filter((c) => c.op === "insert").map((c) => c.client)).toEqual(["session"]);
  });

  it("🔴 X 본인 결의서 수정 — 소유 판정은 X(강사뷰 조회), 수정은 세션 먼저 · 0행이면 관리 클라이언트로", async () => {
    expect(await updateExpense(undefined, expenseForm({ id: "e1" }))).toEqual({ ok: true });
    expect(writes().map((c) => c.client)).toEqual(["session"]);
    m.calls = [];
    m.sessionMutateRows = [];
    expect(await updateExpense(undefined, expenseForm({ id: "e1" }))).toEqual({ ok: true });
    expect(writes().map((c) => c.client)).toEqual(["session", "admin"]);
    expect(tenantEqs("admin")).toBeGreaterThanOrEqual(2); // 소유 조회 + 다시 쓴 수정
  });

  it("A가 쓴 결의서는 X 화면에서 수정할 수 없다", async () => {
    m.row = { ...m.row!, created_by: "a1" };
    expect((await updateExpense(undefined, expenseForm({ id: "e1" })))?.error).toBe("본인이 작성한 지출결의서만 수정할 수 있습니다");
    expect(writes()).toEqual([]);
  });
});

describe("지출 증빙 서명 — 강사뷰에선 RLS(0158a)와 같은 규칙을 X 기준으로", () => {
  const sign = async () => {
    const fd = new FormData();
    fd.set("id", EXPENSE_ID);
    return signExpenseReceipts(undefined, fd);
  };

  it("🔴 X 본인 작성분 + 제출 권한 = 실제로 서명된 증빙이 나온다", async () => {
    const r = await sign();
    expect(r?.error).toBeUndefined();
    expect(r?.urls).toEqual({ [RECEIPT]: `signed://${RECEIPT}` });
  });

  it("🔴 X에게 지출 열람도 제출 권한도 없으면 본인 작성분이어도 서명하지 않는다", async () => {
    m.canWrite.mockResolvedValue(false);
    expect(await sign()).toEqual({ error: "지출을 찾을 수 없습니다" });
  });

  it("남이 쓴 결의서는 지출 열람 권한이 있어야 서명된다", async () => {
    m.row = { ...m.row!, created_by: "a1" };
    expect(await sign()).toEqual({ error: "지출을 찾을 수 없습니다" });
    m.canAccess.mockImplementation(async (_role: string, menu: string) => menu === "billing");
    expect((await sign())?.urls).toEqual({ [RECEIPT]: `signed://${RECEIPT}` });
  });

  it("열람 전용 강사뷰는 쓰기 캡과 무관하게 X의 결의서 증빙을 본다(메뉴 접근이 있을 때)", async () => {
    m.viewAs.mockResolvedValue({ ...X, access: "readonly" });
    m.canWrite.mockResolvedValue(false);
    m.canAccess.mockImplementation(async (_role: string, menu: string) => menu === "expense_requests");
    expect((await sign())?.urls).toEqual({ [RECEIPT]: `signed://${RECEIPT}` });
  });
});

describe("'X의 결의서' 목록", () => {
  it("🔴 강사뷰(대상 = 조회 id)면 관리 클라이언트 + 지점 + created_by = X", async () => {
    await getMyExpenseRequests("x1");
    expect(tenantEqs("admin")).toBe(1);
    expect(m.calls).toContainEqual({ client: "admin", op: "eq", args: ["created_by", "x1"] });
  });

  it("강사뷰가 아니거나 대상이 아닌 id면 세션 클라이언트", async () => {
    await getMyExpenseRequests("someone-else");
    expect(m.calls.every((c) => c.client === "session")).toBe(true);
  });

  // 적대 재리뷰 2026-11-05 — 목록·상세·증빙 서명이 한 판정(expense-visibility.ts). 서명만 막히면 "목록엔 있는데 증빙은 없음".
  it("🔴 X에게 지출 열람도 제출 권한도 없으면 X 작성분이어도 목록이 비고, 조회조차 나가지 않는다", async () => {
    m.canWrite.mockResolvedValue(false);
    m.list = [m.row];
    expect(await getMyExpenseRequests("x1")).toEqual([]);
    expect(m.calls).toEqual([]);
  });
});

describe("지출결의서 상세 — 강사뷰면 목록과 같은 길", () => {
  it("🔴 강사뷰면 관리 클라이언트 + 지점 명시 — A의 RLS가 숨겨도 X의 결의서가 열린다", async () => {
    expect((await getExpenseById(EXPENSE_ID))?.createdBy).toBe("x1");
    expect(m.calls.every((c) => c.client === "admin")).toBe(true);
    expect(tenantEqs("admin")).toBe(1);
  });

  it("🔴 X가 못 보는 결의서는 상세도 없다 — 서명과 같은 판정", async () => {
    m.row = { ...m.row!, created_by: "a1" };
    expect(await getExpenseById(EXPENSE_ID)).toBeNull();
    m.row = { ...m.row!, created_by: "x1" };
    m.canWrite.mockResolvedValue(false);
    expect(await getExpenseById(EXPENSE_ID)).toBeNull();
  });

  it("강사뷰가 아니면 세션 그대로(RLS가 거른다)", async () => {
    m.viewAs.mockResolvedValue(null);
    m.row = { ...m.row!, created_by: "a1" };
    expect((await getExpenseById(EXPENSE_ID))?.createdBy).toBe("a1");
    expect(m.calls.every((c) => c.client === "session")).toBe(true);
  });
});
