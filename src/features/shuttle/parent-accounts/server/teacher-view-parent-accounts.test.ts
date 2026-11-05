/**
 * 셔틀 학부모 계정 발급·삭제는 **화면 주인**의 역할로 판정하고, 읽기 강사뷰는 맨 앞에서 거절한다(2026-11-05 강사뷰 신원 적대 리뷰).
 *
 * 결함 모양(리뷰어 재현): 원장 A가 '다른 강사 뷰'(읽기)로 강사 X를 열어도 parentAccountsActor()가 실제 계정(원장) 역할만 보고,
 * readonlyTeacherViewError를 묻지 않아 학부모 로그인 계정이 만들어졌다. 셔틀 화면은 X로 열리는데 [학부모 계정] 버튼은 A로 섰다.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const A = { id: "a-master", tenantId: "t1", email: "", displayName: "원장", jobTitle: null, systemRole: "master" as const };
const X = { id: "x-teacher", tenantId: "t1", email: "", displayName: "강사X", jobTitle: null, systemRole: "teacher" as const };
const READONLY = "다른 강사 뷰(읽기)에서는 저장할 수 없습니다";

const m = vi.hoisted(() => ({
  target: null as unknown, // 강사뷰 대상(없으면 실제 계정 그대로)
  readonly: null as string | null,
  createUser: vi.fn(),
  deleteUser: vi.fn(),
  inserts: [] as unknown[][],
  deletes: [] as string[],
  readonlyCalls: 0,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("404"); }, redirect: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: async (o?: { teacherView?: boolean }) => (o?.teacherView && m.target ? m.target : A),
}));
vi.mock("@/lib/auth/super-admin", () => ({ isCurrentUserSuperAdmin: async () => false }));
vi.mock("@/lib/auth/view-as", () => ({
  readonlyTeacherViewError: async () => { m.readonlyCalls++; return m.readonly; },
}));
vi.mock("@/features/audit/server/log", () => ({ logAction: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: { admin: { createUser: m.createUser, deleteUser: m.deleteUser, getUserById: async () => ({ data: { user: { app_metadata: { account_type: "parent" } } } }) } },
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      let cols = "";
      q.select = (c: string) => { cols = c; return q; };
      for (const k of ["eq", "ilike"]) q[k] = () => q;
      q.maybeSingle = async () => {
        if (table === "students") return { data: { id: "s1", tenant_id: "t1", status: "enrolled" } };
        // 삭제 경로의 대상 읽기(auth_user_id 포함)만 행이 있다 — 발급 경로의 이메일 중복 확인은 비어 있다.
        if (table === "parent_accounts" && cols.includes("auth_user_id")) return { data: { id: "p1", auth_user_id: "auth-p1", display_name: "학부모" }, error: null };
        return { data: null };
      };
      q.then = (r: (v: unknown) => void) => r({ count: 1, error: null });
      q.insert = (row: unknown) => {
        m.inserts.push([table, row]);
        return { select: () => ({ single: async () => ({ data: { id: "p1" }, error: null }) }), then: (r: (v: unknown) => void) => r({ error: null }) };
      };
      q.delete = () => { m.deletes.push(table); const d: Record<string, unknown> = {}; d.eq = () => d; d.then = (r: (v: unknown) => void) => r({ error: null }); return d; };
      return q;
    },
  }),
}));

import { createParentAccount, deleteParentAccount } from "./parent-actions";
import { parentAccountsActor, requireParentAccountsAccess } from "./parent-access";

const form = () => {
  const fd = new FormData();
  fd.set("displayName", "학부모"); fd.set("email", "p@example.com"); fd.set("password", "12345678"); fd.set("studentId", "s1");
  return fd;
};

beforeEach(() => {
  vi.clearAllMocks();
  m.target = null;
  m.readonly = null;
  m.inserts = [];
  m.deletes = [];
  m.readonlyCalls = 0;
  m.createUser.mockResolvedValue({ data: { user: { id: "auth-new" } }, error: null });
  m.deleteUser.mockResolvedValue({ error: null });
});

describe("🔴 읽기 강사뷰 — 발급·삭제를 맨 앞에서 거절한다(리뷰어 재현의 정반대)", () => {
  it("발급: 읽기 문구로 거절하고 로그인 계정·학부모 행을 만들지 않는다", async () => {
    m.target = X; m.readonly = READONLY;
    expect(await createParentAccount({}, form())).toEqual({ error: READONLY });
    expect(m.readonlyCalls).toBe(1);
    expect(m.createUser).not.toHaveBeenCalled();
    expect(m.inserts).toEqual([]);
  });

  it("삭제: 읽기 문구로 거절하고 로그인 계정을 지우지 않는다", async () => {
    m.target = X; m.readonly = READONLY;
    expect(await deleteParentAccount("p1")).toEqual({ error: READONLY });
    expect(m.deleteUser).not.toHaveBeenCalled();
    expect(m.deletes).toEqual([]);
  });

  it("대상이 원장이어도(읽기) 거절한다 — 역할과 무관하게 쓰지 않는다", async () => {
    m.target = { ...A, id: "x-master" }; m.readonly = READONLY;
    expect(await createParentAccount({}, form())).toEqual({ error: READONLY });
    expect(m.createUser).not.toHaveBeenCalled();
  });
});

describe("역할 판정은 화면 주인", () => {
  it("전체 강사뷰로 강사 X를 열면 실제 계정이 원장이어도 학부모 계정을 다루지 못한다(화면 404 · 액션 거절)", async () => {
    m.target = X;
    expect(await parentAccountsActor()).toBeNull();
    await expect(requireParentAccountsAccess()).rejects.toThrow("404");
    expect(await createParentAccount({}, form())).toEqual({ error: "학부모 계정은 원장·관리자만 발급할 수 있습니다" });
    expect(await deleteParentAccount("p1")).toEqual({ error: "학부모 계정은 원장·관리자만 삭제할 수 있습니다" });
    expect(m.createUser).not.toHaveBeenCalled();
    expect(m.deleteUser).not.toHaveBeenCalled();
  });

  it("강사뷰가 아니면 원장 그대로 발급·삭제한다(종전 동작)", async () => {
    expect(await parentAccountsActor()).toEqual(A);
    expect(await createParentAccount({}, form())).toEqual({ ok: true });
    expect(m.createUser).toHaveBeenCalledTimes(1);
    expect(m.inserts.map((r) => r[0])).toEqual(["parent_accounts", "parent_account_students"]);
  });

  it("강사뷰가 아니면 삭제도 그대로다", async () => {
    expect(await deleteParentAccount("p1")).toEqual({ ok: true });
    expect(m.deleteUser).toHaveBeenCalledWith("auth-p1");
  });
});
