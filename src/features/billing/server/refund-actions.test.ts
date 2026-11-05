import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 환불 요청서 — '다른 강사 뷰'면 **대상 직원**이 작성자(uploaded_by)·환불완료 처리자(completedBy)다(원장 2026-11-05 강사뷰 전수).
 * DB의 restricted 백스톱은 로그인 계정 역할로 사무실 여부를 보므로, 강사뷰에서는 앱 게이트(대상의 수납 쓰기)를 지난 뒤 관리 클라이언트로
 * 지점(tenant_id)을 명시해 쓴다. 강사뷰가 아니면 종전 그대로 세션 클라이언트(RLS).
 */
const m = vi.hoisted(() => ({ user: vi.fn(), canWrite: vi.fn(), viewAs: vi.fn(), calls: [] as unknown[][], log: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canWriteTenant: m.canWrite }));
vi.mock("@/lib/auth/view-as", () => ({ viewAsTeacher: m.viewAs }));
vi.mock("@/features/audit/server/log", () => ({ logAction: m.log }));
vi.mock("./refund-queries", () => ({ getRefundPrefillSource: vi.fn(), getRefundStudentOptions: vi.fn() }));
/** 어느 클라이언트(`via`)로 무엇을 했는지 적는다. */
const db = (via: string) => ({
  from: (table: string) => {
    const q: Record<string, unknown> = {};
    const rec = (op: string) => (...args: unknown[]) => { m.calls.push([via, table, op, ...args]); return q; };
    Object.assign(q, {
      select: rec("select"), eq: rec("eq"), update: rec("update"), delete: rec("delete"),
      insert: rec("insert"),
      maybeSingle: async () => ({ data: null, error: null }),
      single: async () => ({ data: { id: "doc1" }, error: null }),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [{ id: "doc1" }], error: null }).then(resolve),
    });
    return q;
  },
});
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => db("session") }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db("admin") }));
import { deleteRefundRequest, saveRefundRequest } from "./refund-actions";

const actual = { id: "actual", tenantId: "t1", systemRole: "master", displayName: "원장" };
const target = { id: "target", tenantId: "t1", systemRole: "accountant", displayName: "회계" };
const form = () => {
  const fd = new FormData();
  fd.set("s_name", "학생");
  fd.set("res_completedDate", "2026-11-05");
  return fd;
};
const inserted = () => m.calls.find((c) => c[2] === "insert")?.[3] as Record<string, unknown> | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  m.calls = [];
  m.canWrite.mockResolvedValue(true);
});

describe("saveRefundRequest — 대상 직원 명의", () => {
  it("강사뷰면 대상 직원이 작성자·완료 처리자이고, 관리 클라이언트로 지점을 명시해 쓴다", async () => {
    m.user.mockImplementation(async (o?: { teacherView: boolean }) => (o?.teacherView ? target : actual));
    m.viewAs.mockResolvedValue({ ...target, access: "full" });
    expect(await saveRefundRequest(undefined, form())).toMatchObject({ ok: true, id: "doc1" });
    expect(m.canWrite).toHaveBeenCalledWith("accountant", "billing");
    const row = inserted();
    expect(m.calls.find((c) => c[2] === "insert")?.[0]).toBe("admin");
    expect(row).toMatchObject({ tenant_id: "t1", uploaded_by: "target", restricted: true });
    expect((row?.form_data as { result: { completedBy: string; completedByName: string } }).result).toMatchObject({ completedBy: "target", completedByName: "회계" });
  });

  it("강사뷰가 아니면 세션 클라이언트·본인 명의 그대로", async () => {
    m.user.mockResolvedValue(actual);
    m.viewAs.mockResolvedValue(null);
    await saveRefundRequest(undefined, form());
    expect(m.calls.find((c) => c[2] === "insert")?.[0]).toBe("session");
    expect(inserted()).toMatchObject({ uploaded_by: "actual" });
  });

  it("대상 직원에게 수납 쓰기 권한이 없으면(읽기 강사뷰 포함) 아무것도 쓰지 않는다", async () => {
    m.user.mockImplementation(async (o?: { teacherView: boolean }) => (o?.teacherView ? target : actual));
    m.canWrite.mockResolvedValue(false);
    expect(await saveRefundRequest(undefined, form())).toEqual({ error: "수납관리 권한이 없습니다" });
    expect(m.calls).toEqual([]);
  });
});

describe("deleteRefundRequest — 강사뷰면 관리 클라이언트 + 지점 명시", () => {
  it("읽기·지우기 모두 tenant_id를 건다", async () => {
    m.user.mockImplementation(async (o?: { teacherView: boolean }) => (o?.teacherView ? target : actual));
    m.viewAs.mockResolvedValue({ ...target, access: "full" });
    expect(await deleteRefundRequest("doc1")).toEqual({ ok: true });
    const tenantFilters = m.calls.filter((c) => c[2] === "eq" && c[3] === "tenant_id");
    expect(tenantFilters.map((c) => [c[0], c[4]])).toEqual([["admin", "t1"], ["admin", "t1"]]);
  });
});
