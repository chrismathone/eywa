import { beforeEach, describe, expect, it, vi } from "vitest";
import { archiveNotification, deleteAllNotifications, deleteNotification, markNotificationsRead } from "./actions";

/** 쓰기 한 번 = 무엇을(op) · 어떤 조건으로(filters). select는 `target` 한 줄을 돌려준다. */
type Call = { op: "select" | "update" | "delete"; filters: string[] };
type Inbox = { tenantId: string; recipientId: string; writable: boolean };
const mocks = vi.hoisted(() => ({
  calls: [] as Call[],
  target: null as { type: string; archived_at: string | null; created_at: string } | null,
  inbox: null as Inbox | null,
}));
vi.mock("./queries", () => ({ DIGEST_TYPE: "staff_task_digest", getMyNotifications: async () => ({ unread: 0, items: [] }) }));
// 받은함 단일 소스(inbox.ts) — 평소 본인 · '다른 강사 뷰'는 그 강사(전체=바꿈 · 읽기=보기만) · 지점 보기는 null.
vi.mock("./inbox", () => ({ notificationInbox: async () => (mocks.inbox ? { ...mocks.inbox, db: fakeDb() } : null) }));
const fakeDb = () => ({
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
        in: (k: string, v: string[]) => (call.filters.push(`${k} in ${v.join(",")}`), chain),
        maybeSingle: async () => (mocks.calls.push(call), { data: mocks.target, error: null }),
        then: (resolve: (v: unknown) => void) => (mocks.calls.push(call), Promise.resolve({ error: null }).then(resolve)),
      };
      return chain;
    },
});

const writes = () => mocks.calls.filter((c) => c.op !== "select").map((c) => `${c.op} ${c.filters.join(" & ")}`);
const CASCADE = "update tenant_id=t1 & recipient_id=me & type=staff_task_digest & archived_at is null & created_at<2026-11-02T22:00:00Z";
const ME: Inbox = { tenantId: "t1", recipientId: "me", writable: true };
beforeEach(() => { mocks.calls = []; mocks.target = null; mocks.inbox = ME; });

describe("받은함 요약을 치우면 가려 둔 지난 요약도 함께 보관(안 그러면 하루 전 요약이 다시 올라온다)", () => {
  it("보관 · 삭제 — 받은함의 요약이면 지난 요약도 보관", async () => {
    mocks.target = { type: "staff_task_digest", archived_at: null, created_at: "2026-11-02T22:00:00Z" };
    await archiveNotification("d1");
    expect(writes()).toEqual([CASCADE, "update tenant_id=t1 & recipient_id=me & id=d1"]);
    mocks.calls = [];
    await deleteNotification("d1");
    expect(writes()).toEqual([CASCADE, "delete tenant_id=t1 & recipient_id=me & id=d1"]);
  });
  it("요약이 아니거나 보관함에서 지우는 요약이면 그것만", async () => {
    mocks.target = { type: "followup_due", archived_at: null, created_at: "2026-11-02T22:00:00Z" };
    await archiveNotification("d1");
    expect(writes()).toEqual(["update tenant_id=t1 & recipient_id=me & id=d1"]);
    mocks.calls = [];
    mocks.target = { type: "staff_task_digest", archived_at: "2026-11-01", created_at: "2026-11-01T22:00:00Z" };
    await deleteNotification("d1", "archived");
    expect(writes()).toEqual(["delete tenant_id=t1 & recipient_id=me & id=d1"]);
  });
});

describe("'다른 강사 뷰'의 받은함(원장 2026-11-05 — 강사뷰는 그 강사로)", () => {
  it("'전체'는 그 강사의 받은함을 그 강사로서 정리한다 — 받는 사람 · 지점을 명시", async () => {
    mocks.inbox = { tenantId: "t1", recipientId: "kim", writable: true };
    mocks.target = { type: "followup_due", archived_at: null, created_at: "2026-11-02T22:00:00Z" };
    await archiveNotification("d1");
    expect(writes()).toEqual(["update tenant_id=t1 & recipient_id=kim & id=d1"]);
    mocks.calls = [];
    await markNotificationsRead(["d1"]);
    expect(writes()).toEqual(["update tenant_id=t1 & recipient_id=kim & read_at is null & id in d1"]);
  });
  it("'읽기'는 보기만 — 읽음 · 보관 · 삭제 · 전체 삭제 어느 것도 그 강사의 받은함을 바꾸지 않는다", async () => {
    mocks.inbox = { tenantId: "t1", recipientId: "kim", writable: false };
    mocks.target = { type: "staff_task_digest", archived_at: null, created_at: "2026-11-02T22:00:00Z" };
    await markNotificationsRead();
    await archiveNotification("d1");
    await deleteNotification("d1");
    await deleteAllNotifications();
    expect(mocks.calls).toEqual([]);
  });
  it("지점 보기(받은함 없음)도 바꾸지 않는다", async () => {
    mocks.inbox = null;
    await deleteAllNotifications();
    await markNotificationsRead();
    expect(mocks.calls).toEqual([]);
  });
});
