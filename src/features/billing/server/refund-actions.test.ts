import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 환불 요청서 — '다른 강사 뷰'면 **대상 직원**이 작성자(uploaded_by)·환불완료 처리자(completedBy)다(원장 2026-11-05 강사뷰 전수).
 * 쓰기는 **세션 먼저**(실제 계정 A의 RLS — 활동 기록·환불 데스크 할 일 닫기의 행위자가 auth.uid()라서), RLS에 막힐 때만 관리 클라이언트.
 * 요청서는 restricted(계좌·환불금액)라 DB 백스톱(0170a)처럼 **사무 역할**만 쓰고 본다 — 강사뷰면 대상 X의 역할로(적대 리뷰 2026-11-05).
 */
const m = vi.hoisted(() => ({
  user: vi.fn(), canWrite: vi.fn(), viewAs: vi.fn(), calls: [] as unknown[][], log: vi.fn(),
  /** 세션 클라이언트의 쓰기 결과(RLS 흉내) — insert 에러 · update/delete 반환 행. */
  sessionInsertError: null as { code: string; message: string } | null,
  sessionRows: [{ id: "doc1" }] as unknown[],
  listRows: [] as unknown[],
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canWriteTenant: m.canWrite }));
vi.mock("@/lib/auth/view-as", () => ({ viewAsTeacher: m.viewAs }));
vi.mock("@/features/audit/server/log", () => ({ logAction: m.log }));
vi.mock("@/features/students/server/queries", () => ({ getStudentEnrollments: vi.fn() }));
/** 어느 클라이언트(`via`)로 무엇을 했는지 적는다. */
const db = (via: "session" | "admin") => ({
  from: (table: string) => {
    const q: Record<string, unknown> = {};
    let op = "select";
    const rec = (name: string) => (...args: unknown[]) => {
      if (["insert", "update", "delete"].includes(name)) op = name;
      m.calls.push([via, table, name, ...args]);
      return q;
    };
    Object.assign(q, {
      select: rec("select"), eq: rec("eq"), update: rec("update"), delete: rec("delete"), insert: rec("insert"), order: rec("order"),
      maybeSingle: async () => ({ data: null, error: null }),
      single: async () =>
        via === "session" && op === "insert" && m.sessionInsertError
          ? { data: null, error: m.sessionInsertError }
          : { data: { id: "doc1" }, error: null },
      then: (resolve: (v: unknown) => unknown) => {
        if (op === "select") return Promise.resolve({ data: m.listRows, error: null }).then(resolve);
        return Promise.resolve({ data: via === "session" ? m.sessionRows : [{ id: "doc1" }], error: null }).then(resolve);
      },
    });
    return q;
  },
});
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => db("session") }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db("admin") }));
import { deleteRefundRequest, saveRefundRequest } from "./refund-actions";
import { getRefundRequestById, getRefundRequests } from "./refund-queries";

const actual = { id: "actual", tenantId: "t1", systemRole: "master", displayName: "원장" };
const target = { id: "target", tenantId: "t1", systemRole: "accountant", displayName: "회계" };
const counselor = { id: "coun", tenantId: "t1", systemRole: "counselor", displayName: "상담실장" };
const form = () => {
  const fd = new FormData();
  fd.set("s_name", "학생");
  fd.set("res_completedDate", "2026-11-05");
  return fd;
};
const writes = () => m.calls.filter((c) => ["insert", "update", "delete"].includes(c[2] as string));
const inserted = () => writes().find((c) => c[2] === "insert" && c[0] === "admin")?.[3] ?? writes().find((c) => c[2] === "insert")?.[3];
const asTeacherView = (who: typeof target) => {
  m.user.mockImplementation(async (o?: { teacherView: boolean }) => (o?.teacherView ? who : actual));
  m.viewAs.mockResolvedValue({ ...who, access: "full" });
};

beforeEach(() => {
  vi.clearAllMocks();
  m.calls = [];
  m.canWrite.mockResolvedValue(true);
  m.sessionInsertError = null;
  m.sessionRows = [{ id: "doc1" }];
  m.listRows = [];
});

describe("saveRefundRequest — 대상 직원 명의 · 세션 먼저", () => {
  it("🔴 강사뷰여도 A의 세션이 통과하면 세션으로 쓴다(활동 기록의 행위자가 남는다) — 작성자·완료 처리자는 X", async () => {
    asTeacherView(target);
    expect(await saveRefundRequest(undefined, form())).toMatchObject({ ok: true, id: "doc1" });
    expect(m.canWrite).toHaveBeenCalledWith("accountant", "billing");
    expect(writes().map((c) => c[0])).toEqual(["session"]);
    const row = inserted() as Record<string, unknown>;
    expect(row).toMatchObject({ tenant_id: "t1", uploaded_by: "target", restricted: true });
    expect((row.form_data as { result: { completedBy: string; completedByName: string } }).result).toMatchObject({ completedBy: "target", completedByName: "회계" });
  });

  it("🔴 A의 세션이 RLS(42501)에 막히면 그때만 관리 클라이언트로 같은 행을 다시 쓴다", async () => {
    asTeacherView(target);
    m.sessionInsertError = { code: "42501", message: "new row violates row-level security policy" };
    expect(await saveRefundRequest(undefined, form())).toMatchObject({ ok: true, id: "doc1" });
    expect(writes().map((c) => c[0])).toEqual(["session", "admin"]);
    expect(inserted()).toMatchObject({ tenant_id: "t1", uploaded_by: "target" });
  });

  it("강사뷰가 아니면 세션 클라이언트·본인 명의 그대로(막혀도 관리 클라이언트로 내려가지 않는다)", async () => {
    m.user.mockResolvedValue(actual);
    m.viewAs.mockResolvedValue(null);
    m.sessionInsertError = { code: "42501", message: "rls" };
    expect((await saveRefundRequest(undefined, form()))?.error).toContain("저장 실패");
    expect(writes().map((c) => c[0])).toEqual(["session"]);
    expect(inserted()).toMatchObject({ uploaded_by: "actual" });
  });

  it("대상 직원에게 수납 쓰기 권한이 없으면(읽기 강사뷰 포함) 아무것도 쓰지 않는다", async () => {
    asTeacherView(target);
    m.canWrite.mockResolvedValue(false);
    expect(await saveRefundRequest(undefined, form())).toEqual({ error: "수납관리 권한이 없습니다" });
    expect(m.calls).toEqual([]);
  });

  it("🔴 수납 쓰기 예외가 있어도 사무 역할이 아니면(상담) restricted 요청서를 못 쓴다 — DB 백스톱(0170a)과 같은 역할 목록", async () => {
    asTeacherView(counselor);
    expect(await saveRefundRequest(undefined, form())).toEqual({ error: "수납관리 권한이 없습니다" });
    expect(await deleteRefundRequest("doc1")).toEqual({ error: "수납관리 권한이 없습니다" });
    expect(m.calls).toEqual([]);
  });
});

describe("deleteRefundRequest — 읽기는 강사뷰 관리 클라이언트, 지우기는 세션 먼저", () => {
  it("읽기·지우기 모두 tenant_id를 걸고, 세션이 지우면 관리 클라이언트로 내려가지 않는다", async () => {
    asTeacherView(target);
    expect(await deleteRefundRequest("doc1")).toEqual({ ok: true });
    const tenantFilters = m.calls.filter((c) => c[2] === "eq" && c[3] === "tenant_id");
    expect(tenantFilters.map((c) => [c[0], c[4]])).toEqual([["admin", "t1"], ["session", "t1"]]);
    expect(writes().map((c) => c[0])).toEqual(["session"]);
  });

  it("🔴 세션이 RLS로 0행을 지우면(에러 없음) 관리 클라이언트로 같은 조건을 다시", async () => {
    asTeacherView(target);
    m.sessionRows = [];
    expect(await deleteRefundRequest("doc1")).toEqual({ ok: true });
    expect(writes().map((c) => c[0])).toEqual(["session", "admin"]);
    const adminEqs = m.calls.filter((c) => c[0] === "admin" && c[2] === "eq").map((c) => c[3]);
    expect(adminEqs).toEqual(expect.arrayContaining(["tenant_id", "id", "form_type"]));
  });
});

describe("환불 요청서 조회 — 대상 X의 역할로 restricted를 거른다", () => {
  it("🔴 강사뷰 대상이 사무 역할이 아니면 목록·상세 모두 restricted = false로 좁힌다", async () => {
    asTeacherView(counselor);
    m.listRows = [];
    await getRefundRequests();
    await getRefundRequestById("doc1");
    expect(m.calls.filter((c) => c[2] === "eq" && c[3] === "restricted").map((c) => c[4])).toEqual([false, false]);
  });

  it("평소(사무 역할 본인)에는 필터를 더하지 않는다 — DB와 같은 결과", async () => {
    m.user.mockResolvedValue(actual);
    m.viewAs.mockResolvedValue(null);
    await getRefundRequests();
    expect(m.calls.some((c) => c[2] === "eq" && c[3] === "restricted")).toBe(false);
  });
});
