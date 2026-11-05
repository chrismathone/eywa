import { beforeEach, expect, it, vi } from "vitest";
import type { CurrentUser } from "@/lib/auth/current-user";

/**
 * '학부모 글·답글' 면 — '다른 강사 뷰'면 공감 버튼·'내 공감'·관리자급 판정이 **대상 직원** 기준이다(답글 액션의 첫 문 `replyGate`와 같은 사람).
 * 페이지는 로그인 계정(requireAccess)을 넘긴다 — 그 사람으로 판정하면 원장 자격으로 버튼이 서고 누르면 서버가 거절한다(#77).
 */
const m = vi.hoisted(() => ({ user: vi.fn(), superAdmin: vi.fn(), view: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/auth/super-admin", () => ({ isCurrentUserSuperAdmin: m.superAdmin }));
vi.mock("@/lib/auth/view-mode", () => ({ readonlyTeacherViewError: async () => null }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("./reaction-data", () => ({ reactionReady: async () => true, loadReactions: async () => new Map(), toReactionView: m.view }));
vi.mock("./thread-media-counts", () => ({ countThreadMedia: async () => new Map() }));
vi.mock("@/lib/supabase/batch", () => ({ fetchInChunks: async () => [] }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: () => {
  const q = {
    select: () => q, gte: () => q, limit: () => q, order: () => q, range: () => q,
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ count: 1, error: null,
      data: [{ id: "msg", source: "post", content: "안녕하세요", posted_at: "2026-11-05T01:00:00Z", class_name: "[수학] 테스트반", child_id: 5268389 }],
    }).then(resolve),
  };
  return q;
} }) }));
import { listParentThreads } from "./reply-queries";

const actual = { id: "actual", tenantId: "t1", systemRole: "master", displayName: "원장" } as CurrentUser;
const target = { id: "target", tenantId: "t1", systemRole: "teacher", displayName: "강사" } as CurrentUser;

beforeEach(() => {
  vi.clearAllMocks();
  m.superAdmin.mockResolvedValue(false);
  m.view.mockReturnValue(null);
});

it("강사뷰면 대상 직원으로 공감 상태를 판정한다(관리자급 = 대상 역할 — 원장 자격이 새지 않는다)", async () => {
  m.user.mockImplementation(async (o?: { teacherView: boolean }) => (o?.teacherView ? target : actual));
  const view = await listParentThreads({ mode: "test", user: actual });
  expect(view.rows).toHaveLength(1);
  expect(m.user).toHaveBeenCalledWith({ teacherView: true });
  expect(m.view).toHaveBeenCalledWith("msg", null, target, false, false);
});

it("강사뷰가 아니면(대상 = 본인) 그 사람 그대로 — 원장은 관리자급", async () => {
  m.user.mockResolvedValue(actual);
  await listParentThreads({ mode: "test", user: actual });
  expect(m.view).toHaveBeenCalledWith("msg", null, actual, true, false);
});
