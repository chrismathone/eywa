import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 학원 공지 액션 — '다른 강사 뷰'면 **대상 직원**이 행위자다: 직원 관리 역할 판정(canManageStaff)과 공지 작성자(author_id).
 * 로그인 계정(원장)으로 열면 대상 직원(예: 회계)이 못 하는 공지 작성이 그 화면에서 열리고, 글이 원장 명의로 남는다(원장 2026-11-05 강사뷰 전수).
 * 감사로그 행위자는 로그인 계정 그대로(logAction이 스스로 읽는다).
 */
const m = vi.hoisted(() => ({ user: vi.fn(), canWrite: vi.fn(), insert: vi.fn(), log: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canWriteTenant: m.canWrite }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: () => ({ insert: m.insert }) }) }));
vi.mock("@/features/audit/server/log", () => ({ logAction: m.log }));
vi.mock("./briefing", () => ({ generateDailyBriefing: vi.fn() }));
import { createAnnouncement } from "./actions";

const actual = { id: "actual", tenantId: "t1", systemRole: "master", displayName: "원장" };
const form = () => {
  const fd = new FormData();
  fd.set("title", "제목");
  fd.set("content", "내용");
  return fd;
};

beforeEach(() => {
  vi.clearAllMocks();
  m.canWrite.mockResolvedValue(true);
  m.insert.mockResolvedValue({ error: null });
});

describe("createAnnouncement — 행위자는 강사뷰 대상", () => {
  it("대상 직원이 관리자면 그 사람 명의(author_id)로 쓴다 — 로그인 계정 id가 아니다", async () => {
    const target = { id: "target", tenantId: "t1", systemRole: "admin", displayName: "실장" };
    m.user.mockImplementation(async (o?: { teacherView: boolean }) => (o?.teacherView ? target : actual));
    expect(await createAnnouncement(undefined, form())).toEqual({ ok: true });
    expect(m.user).toHaveBeenCalledWith({ teacherView: true });
    expect(m.insert).toHaveBeenCalledWith(expect.objectContaining({ tenant_id: "t1", author_id: "target" }));
    expect(m.canWrite).toHaveBeenCalledWith("admin", "dashboard");
  });

  it("대상 직원이 직원 관리 역할이 아니면(회계) 로그인 계정이 원장이어도 거절한다", async () => {
    const target = { id: "target", tenantId: "t1", systemRole: "accountant", displayName: "회계" };
    m.user.mockImplementation(async (o?: { teacherView: boolean }) => (o?.teacherView ? target : actual));
    expect(await createAnnouncement(undefined, form())).toEqual({ error: "공지 작성 권한이 없습니다" });
    expect(m.insert).not.toHaveBeenCalled();
  });

  it("강사뷰가 아니면 본인 그대로", async () => {
    m.user.mockResolvedValue(actual);
    expect(await createAnnouncement(undefined, form())).toEqual({ ok: true });
    expect(m.insert).toHaveBeenCalledWith(expect.objectContaining({ author_id: "actual" }));
  });
});
