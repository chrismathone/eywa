import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 도움말 게시판 — '다른 강사 뷰'(원장 A가 강사 X 화면)에서 **X로 완전히 바뀌는지**.
 * 작성자 명의 · '자기 글' 판정 · 답변 역할은 X, 읽기 강사뷰는 관리 클라이언트에 닿기 전에 거절.
 */
const m = vi.hoisted(() => ({
  real: { id: "A", tenantId: "t1", systemRole: "master", displayName: "원장" } as Record<string, unknown>,
  target: { id: "X", tenantId: "t1", systemRole: "teacher", displayName: "강사" } as Record<string, unknown> | null,
  readonly: vi.fn(),
  canWrite: vi.fn(),
  superAdmin: vi.fn(),
  notifyQuestion: vi.fn(),
  notifyAnswer: vi.fn(),
  log: vi.fn(),
  from: vi.fn(),
  post: null as Record<string, unknown> | null,
  calls: [] as { table: string; op: string; payload?: unknown; filters: unknown[][] }[],
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: async (opts?: { teacherView: boolean }) => (opts?.teacherView ? (m.target ?? m.real) : m.real),
}));
vi.mock("@/lib/auth/view-as", () => ({ readonlyTeacherViewError: m.readonly }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canWriteTenant: m.canWrite }));
vi.mock("@/lib/auth/super-admin", () => ({ isCurrentUserSuperAdmin: m.superAdmin }));
vi.mock("@/features/audit/server/log", () => ({ logAction: m.log }));
vi.mock("./notify", () => ({ notifyHelpQuestion: m.notifyQuestion, notifyHelpAnswer: m.notifyAnswer }));
vi.mock("@/lib/supabase/db-error", () => ({ logDbError: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: m.from }) }));

import { closeHelpPost, createHelpAnswer, createHelpPost, deleteHelpPost, updateHelpPost } from "./actions";

beforeEach(() => {
  vi.clearAllMocks();
  m.real = { id: "A", tenantId: "t1", systemRole: "master", displayName: "원장" };
  m.target = { id: "X", tenantId: "t1", systemRole: "teacher", displayName: "강사" };
  m.readonly.mockResolvedValue(null);
  m.canWrite.mockResolvedValue(true);
  m.superAdmin.mockResolvedValue(false);
  m.post = { id: "p1", author_id: "X", title: "질문", status: "open", tenant_id: "t1" };
  m.calls = [];
  m.from.mockImplementation((table: string) => {
    const entry: { table: string; op: string; payload?: unknown; filters: unknown[][] } = { table, op: "select", filters: [] };
    m.calls.push(entry);
    const q = {
      select: () => q,
      insert: (payload: unknown) => ((entry.op = "insert"), (entry.payload = payload), q),
      update: (payload: unknown) => ((entry.op = "update"), (entry.payload = payload), q),
      delete: () => ((entry.op = "delete"), q),
      eq: (k: string, v: unknown) => (entry.filters.push([k, v]), q),
      maybeSingle: async () => ({ data: entry.op === "insert" ? { id: "new" } : m.post, error: null }),
      then: (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    };
    return q;
  });
});

const writes = () => m.calls.filter((c) => c.op !== "select");

describe("도움말 게시판 — 강사뷰 신원", () => {
  it("질문 작성자 명의와 알림 행위자가 대상 X다", async () => {
    expect(await createHelpPost({ title: "제목", body: "내용" })).toEqual({ ok: true, id: "new" });
    expect(writes()[0]).toMatchObject({ table: "help_posts", op: "insert", payload: { tenant_id: "t1", author_id: "X" } });
    expect(m.notifyQuestion).toHaveBeenCalledWith(expect.objectContaining({ actorId: "X" }));
  });

  it("읽기 강사뷰는 관리 클라이언트에 닿기 전에 거절한다(작성 · 수정 · 삭제 · 답변 · 닫기)", async () => {
    m.readonly.mockResolvedValue("열람 전용");
    m.superAdmin.mockResolvedValue(true); // 총괄 우회가 있어도 막힌다
    expect(await createHelpPost({ title: "제목", body: "내용" })).toEqual({ error: "열람 전용" });
    expect(await updateHelpPost("p1", { title: "제목", body: "내용" })).toEqual({ error: "열람 전용" });
    expect(await deleteHelpPost("p1")).toEqual({ error: "열람 전용" });
    expect(await createHelpAnswer("p1", "답")).toEqual({ error: "열람 전용" });
    expect(await closeHelpPost("p1")).toEqual({ error: "열람 전용" });
    expect(m.from).not.toHaveBeenCalled();
    expect(m.log).not.toHaveBeenCalled();
  });

  it("'자기 글' 판정이 X 기준 — X 글은 고치고 지우며, 실제 계정 A의 글은 X 화면에서 못 고친다", async () => {
    expect(await updateHelpPost("p1", { title: "제목", body: "내용" })).toEqual({ ok: true, id: "p1" });
    expect(await deleteHelpPost("p1")).toEqual({ ok: true, id: "p1" });
    m.post = { ...m.post!, author_id: "A" };
    expect(await updateHelpPost("p1", { title: "제목", body: "내용" })).toEqual({ error: "자기 글만 고칠 수 있습니다" });
    expect(await deleteHelpPost("p1")).toEqual({ error: "자기 글만 지울 수 있습니다" });
  });

  it("답변 역할은 대상 X — 원장이 강사 X 화면에서 답변하지 못한다", async () => {
    expect(await createHelpAnswer("p1", "답")).toEqual({ error: "답변할 권한이 없습니다" });
    expect(writes()).toEqual([]);
  });

  it("대상이 관리자면 X 명의로 답변이 남고 알림 행위자도 X다", async () => {
    m.target = { id: "X", tenantId: "t1", systemRole: "admin", displayName: "관리자" };
    m.post = { ...m.post!, author_id: "Q" };
    expect(await createHelpAnswer("p1", "답")).toEqual({ ok: true, id: "new" });
    expect(writes()[0]).toMatchObject({ table: "help_answers", op: "insert", payload: { author_id: "X", post_id: "p1" } });
    expect(m.notifyAnswer).toHaveBeenCalledWith(expect.objectContaining({ actorId: "X", authorId: "Q" }));
  });

  it("닫기 — 강사 X는 자기 글만, 남의 글은 원장 역할로 닫히지 않는다", async () => {
    expect(await closeHelpPost("p1")).toEqual({ ok: true, id: "p1" });
    m.post = { ...m.post!, author_id: "Q" };
    expect(await closeHelpPost("p1")).toEqual({ error: "이 글을 닫을 권한이 없습니다" });
  });

  it("강사뷰가 아니면 종전대로 실제 계정 — 원장은 남의 글에 답한다", async () => {
    m.target = null;
    m.post = { ...m.post!, author_id: "Q" };
    expect(await createHelpAnswer("p1", "답")).toEqual({ ok: true, id: "new" });
    expect(writes()[0]).toMatchObject({ payload: { author_id: "A" } });
  });
});
