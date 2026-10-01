import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  gate: { ok: true } as Record<string, unknown>,
  canReply: true,
  focus: null as Record<string, unknown> | null,
  all: [] as Record<string, unknown>[],
  calls: [] as Record<string, unknown>[],
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("./reply-gate", () => ({ replyGate: async () => h.gate }));
vi.mock("./reply-permission", () => ({ decideReplyPermission: async () => ({ canReply: h.canReply, studentId: "stu-A" }) }));
vi.mock("./reply-data", () => ({ loadMessage: async () => h.focus, loadMessagesByPosts: async () => h.all }));
vi.mock("./thread-data", async (orig) => {
  const real = await orig<typeof import("./thread-data")>();
  return {
    threadScope: real.threadScope,
    loadThreadVideos: async (_admin: unknown, a: Record<string, unknown>) => {
      h.calls.push(a);
      return { byMessage: new Map([["m-post", [{ id: "v1" }]]]), canWatch: true };
    },
  };
});

import { getThreadVideoStates } from "./video-poll";

const msg = (id: string, cid: number | null, childId: number | null) => ({ id, source: cid ? "comment" : "post", classnotePostId: 10, classnoteCommentId: cid, childId, studentId: null, boardName: "x", content: "c", postedAt: null });

beforeEach(() => {
  h.gate = { ok: true, user: { tenantId: "t1" }, manager: false, sendOn: true, mode: "on" };
  h.canReply = true;
  h.focus = msg("m-post", null, 7);
  h.all = [msg("m-post", null, 7), msg("m-c1", 1, 7), msg("m-x", 2, 99)];
  h.calls = [];
});

describe("영상 상태 폴링(GET 라우트 뒤) — 답글 창과 같은 게이트·같은 범위", () => {
  it("🔴 문을 못 넘으면(모드 끔·로그인 없음) 영상 0 — 조회도 안 한다", async () => {
    h.gate = { ok: false, error: "사용할 수 없는 기능입니다" };
    expect(await getThreadVideoStates("m-post")).toEqual({});
    expect(h.calls).toHaveLength(0);
  });

  it("🔴 답글 자격이 없으면(담당 아님·열람 전용) 영상 0", async () => {
    h.canReply = false;
    expect(await getThreadVideoStates("m-post")).toEqual({});
    expect(h.calls).toHaveLength(0);
  });

  it("범위 = threadScope(같은 글·같은 원아) · 학생 미확정 영상 취급도 답글 창과 같다", async () => {
    expect(await getThreadVideoStates("m-post")).toEqual({ "m-post": [{ id: "v1" }] });
    expect((h.calls[0]!.messages as { id: string }[]).map((m) => m.id)).toEqual(["m-post", "m-c1"]);
    expect(h.calls[0]!.allowUnmatched).toBe(true);
    // 원아를 모르는 글 — 그 글 하나, 학생 미확정 영상은 싣지 않는다(옛 폴링은 원아 null끼리 묶었다).
    h.focus = msg("m-post", null, null);
    h.all = [msg("m-post", null, null), msg("m-y", 3, null)];
    await getThreadVideoStates("m-post");
    expect((h.calls[1]!.messages as { id: string }[]).map((m) => m.id)).toEqual(["m-post"]);
    expect(h.calls[1]!.allowUnmatched).toBe(false);
  });
});
