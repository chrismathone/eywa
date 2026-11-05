import { beforeEach, expect, it, vi } from "vitest";
import type { CurrentUser } from "@/lib/auth/current-user";
const m = vi.hoisted(() => ({ ranges: [] as number[][], orders: [] as string[], total: 136 }));
vi.mock("@/lib/auth/super-admin", () => ({ isCurrentUserSuperAdmin: async () => true }));
// 강사뷰가 아니면 대상 사람이 없다 → 페이지가 넘긴 사람 그대로(reply-queries-teacher-view.test.ts가 강사뷰를 본다).
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => null }));
vi.mock("@/lib/auth/view-mode", () => ({ readonlyTeacherViewError: async () => null }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("./reaction-data", () => ({ reactionReady: async () => false, loadReactions: vi.fn(), toReactionView: vi.fn() }));
vi.mock("./thread-media-counts", () => ({ countThreadMedia: async () => new Map() }));
vi.mock("@/lib/supabase/batch", () => ({ fetchInChunks: async () => [] }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: () => {
  let head = false; let range = [0, 99];
  const q = {
    select: (_: string, options?: { head?: boolean }) => { head = !!options?.head; return q; },
    gte: () => q, limit: (n: number) => { range = [0, n - 1]; return q; }, order: (key: string) => { m.orders.push(key); return q; },
    range: (from: number, to: number) => { range = [from, to]; m.ranges.push(range); return q; },
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ count: m.total, error: null,
      data: head ? null : Array.from({ length: Math.max(0, Math.min(range[1] + 1, m.total) - range[0]) }, (_, i) => ({
        id: String(m.total - range[0] - i), source: "post", content: "", posted_at: "2026-10-03T01:00:00Z", class_name: "test", child_id: "1",
      })),
    }).then(resolve),
  }; return q;
} }) }));
import { listParentThreads } from "./reply-queries";
const user = { tenantId: "t1", systemRole: "master" } as CurrentUser;
beforeEach(() => { m.ranges = []; m.orders = []; m.total = 136; });
it("136 same-time messages page into 100 and 36 without overlap", async () => {
  const first = await listParentThreads({ mode: "test", user, page: "1" });
  const second = await listParentThreads({ mode: "test", user, page: "2" });
  expect(first.rows).toHaveLength(100); expect(second.rows).toHaveLength(36);
  expect(new Set([...first.rows, ...second.rows].map((r) => r.messageId)).size).toBe(136);
  expect(m.ranges).toEqual([[0, 99], [100, 199]]); expect(m.orders).toEqual(["posted_at", "id", "posted_at", "id"]);
  expect(second).toMatchObject({ page: 2, totalPages: 2, total: 136 });
});
it("clamps invalid or oversized pages before fetching", async () => {
  expect((await listParentThreads({ mode: "test", user, page: "99999" })).page).toBe(2);
  expect((await listParentThreads({ mode: "test", user, page: "1.5" })).page).toBe(1);
  m.total = 0; expect((await listParentThreads({ mode: "test", user, page: "2" })).page).toBe(1);
  expect(m.ranges).toEqual([[100, 199], [0, 99], [0, 99]]);
});
