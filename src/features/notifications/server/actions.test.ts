import { beforeEach, describe, expect, it, vi } from "vitest";
import { archiveNotification, deleteNotification } from "./actions";

/** 쓰기 한 번 = 무엇을(op) · 어떤 조건으로(filters). select는 `target` 한 줄을 돌려준다. */
type Call = { op: "select" | "update" | "delete"; filters: string[] };
const mocks = vi.hoisted(() => ({ calls: [] as Call[], target: null as { type: string; archived_at: string | null; created_at: string } | null }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => ({ id: "me" }) }));
vi.mock("@/lib/auth/tenant-view", () => ({ isTenantViewWriteBlocked: async () => false }));
vi.mock("./queries", () => ({ DIGEST_TYPE: "staff_task_digest", getMyNotifications: async () => ({ unread: 0, items: [] }) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      const call: Call = { op: "select", filters: [] };
      const chain = {
        select: () => chain,
        update: () => ((call.op = "update"), chain),
        delete: () => ((call.op = "delete"), chain),
        eq: (k: string, v: string) => (call.filters.push(`${k}=${v}`), chain),
        neq: (k: string, v: string) => (call.filters.push(`${k}!=${v}`), chain),
        is: (k: string) => (call.filters.push(`${k} is null`), chain),
        lt: (k: string, v: string) => (call.filters.push(`${k}<${v}`), chain),
        maybeSingle: async () => (mocks.calls.push(call), { data: mocks.target, error: null }),
        then: (resolve: (v: unknown) => void) => (mocks.calls.push(call), Promise.resolve({ error: null }).then(resolve)),
      };
      return chain;
    },
  }),
}));

const writes = () => mocks.calls.filter((c) => c.op !== "select").map((c) => `${c.op} ${c.filters.join(" & ")}`);
const CASCADE = "update recipient_id=me & type=staff_task_digest & archived_at is null & created_at<2026-11-02T22:00:00Z";
beforeEach(() => { mocks.calls = []; mocks.target = null; });

describe("받은함 요약을 치우면 가려 둔 지난 요약도 함께 보관(안 그러면 하루 전 요약이 다시 올라온다)", () => {
  it("보관 · 삭제 — 받은함의 요약이면 지난 요약도 보관", async () => {
    mocks.target = { type: "staff_task_digest", archived_at: null, created_at: "2026-11-02T22:00:00Z" };
    await archiveNotification("d1");
    expect(writes()).toEqual([CASCADE, "update id=d1"]);
    mocks.calls = [];
    await deleteNotification("d1");
    expect(writes()).toEqual([CASCADE, "delete id=d1"]);
  });
  it("요약이 아니거나 보관함에서 지우는 요약이면 그것만", async () => {
    mocks.target = { type: "followup_due", archived_at: null, created_at: "2026-11-02T22:00:00Z" };
    await archiveNotification("d1");
    expect(writes()).toEqual(["update id=d1"]);
    mocks.calls = [];
    mocks.target = { type: "staff_task_digest", archived_at: "2026-11-01", created_at: "2026-11-01T22:00:00Z" };
    await deleteNotification("d1", "archived");
    expect(writes()).toEqual(["delete id=d1"]);
  });
});
