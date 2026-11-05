// 지출결의서 — '다른 강사 뷰'(원장 A가 강사 X 화면)에서 X 명의로 작성·조회·수정된다(원장 2026-11-05 강사뷰 전수).
// DB의 auth.uid()는 A라 세션 클라이언트는 A의 지출 권한으로 RLS가 판정한다 → 강사뷰일 때만 관리 클라이언트 + tenant_id 명시.
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
}));

function client(kind: "session" | "admin") {
  return {
    from: () => {
      const q: Record<string, unknown> = {};
      for (const k of ["select", "eq", "insert", "update", "delete", "order", "limit"]) {
        q[k] = (...args: unknown[]) => { m.calls.push({ client: kind, op: k, args }); return q; };
      }
      q.maybeSingle = async () => ({ data: m.row, error: null });
      q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: m.list, error: null }).then(res);
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
import { getMyExpenseRequests } from "./expense-queries";

const A = { id: "a1", tenantId: "t1", systemRole: "master", displayName: "원장" };
const X = { id: "x1", tenantId: "t1", systemRole: "teacher", displayName: "김선생" };
const tenantEqs = (client: "session" | "admin") =>
  m.calls.filter((c) => c.client === client && c.op === "eq" && c.args[0] === "tenant_id" && c.args[1] === "t1").length;

beforeEach(() => {
  vi.clearAllMocks();
  m.calls = [];
  m.list = [];
  m.user.mockImplementation(async (o?: { teacherView?: boolean }) => (o?.teacherView ? X : A));
  // X(강사)는 지출결의서 own 범위 — billing 쓰기는 없고 expense_requests 쓰기만 있다.
  m.canWrite.mockImplementation(async (_role: string, menu: string) => menu === "expense_requests");
  m.canAccess.mockResolvedValue(false);
  m.viewAs.mockResolvedValue({ ...X, access: "full" });
  m.row = { created_by: "x1", approval_checks: {}, receipt_urls: [{ path: "t1/e1/a.png", name: "a.png" }] };
});

function expenseForm(extra: Record<string, string> = {}) {
  const fd = new FormData();
  fd.set("title", "교재 구입");
  fd.set("amount", "10000");
  fd.set("expenseDate", "2026-11-05");
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return fd;
}

describe("지출결의서 — 강사뷰 신원", () => {
  it("🔴 작성은 X 명의(created_by·작성자) — 강사뷰라 관리 클라이언트, 지점 명시", async () => {
    expect(await createExpense(undefined, expenseForm())).toEqual({ ok: true });
    const insert = m.calls.find((c) => c.op === "insert")!;
    expect(insert.client).toBe("admin");
    expect(insert.args[0]).toMatchObject({ tenant_id: "t1", created_by: "x1", author: "김선생" });
  });

  it("강사뷰가 아니면 종전처럼 세션 클라이언트(RLS)", async () => {
    m.viewAs.mockResolvedValue(null);
    m.user.mockResolvedValue(A);
    m.canWrite.mockResolvedValue(true);
    await createExpense(undefined, expenseForm());
    expect(m.calls.find((c) => c.op === "insert")?.client).toBe("session");
  });

  it("🔴 X 본인 결의서 수정 — 소유 판정은 X, 조회·수정 모두 지점 명시", async () => {
    expect(await updateExpense(undefined, expenseForm({ id: "e1" }))).toEqual({ ok: true });
    expect(m.calls.find((c) => c.op === "update")?.client).toBe("admin");
    expect(tenantEqs("admin")).toBeGreaterThanOrEqual(2);
  });

  it("A가 쓴 결의서는 X 화면에서 수정할 수 없다", async () => {
    m.row = { ...m.row!, created_by: "a1" };
    expect((await updateExpense(undefined, expenseForm({ id: "e1" })))?.error).toBe("본인이 작성한 지출결의서만 수정할 수 있습니다");
    expect(m.calls.some((c) => c.op === "update")).toBe(false);
  });

  it("🔴 증빙 서명 — 강사뷰에선 RLS 대신 같은 규칙(열람 권한 or 본인 작성분)을 앱에서", async () => {
    const fd = new FormData();
    fd.set("id", "e1");
    expect((await signExpenseReceipts(undefined, fd))?.urls).toBeTruthy();
    m.row = { ...m.row!, created_by: "a1" };
    expect(await signExpenseReceipts(undefined, fd)).toEqual({ error: "지출을 찾을 수 없습니다" });
  });

  it("🔴 'X의 결의서' 목록 — 강사뷰(대상 = 조회 id)면 관리 클라이언트 + 지점 + created_by = X", async () => {
    await getMyExpenseRequests("x1");
    expect(tenantEqs("admin")).toBe(1);
    expect(m.calls).toContainEqual({ client: "admin", op: "eq", args: ["created_by", "x1"] });
  });

  it("강사뷰가 아니거나 대상이 아닌 id면 세션 클라이언트", async () => {
    await getMyExpenseRequests("someone-else");
    expect(m.calls.every((c) => c.client === "session")).toBe(true);
  });
});
