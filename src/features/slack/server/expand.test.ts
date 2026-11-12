import { beforeEach, expect, it, vi } from "vitest";
import { expandInbox } from "./expand";
import type { SlackConnection } from "./store";

const mocks = vi.hoisted(() => ({
  from: vi.fn(), optedIn: vi.fn(), optedInState: vi.fn(), upsert: vi.fn(), outboxUpdate: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: mocks.from }) }));
vi.mock("@/lib/license/server", () => ({
  isFeatureOptedInFresh: mocks.optedIn,
  getFeatureOptInStateFresh: mocks.optedInState,
}));
vi.mock("@/lib/supabase/batch", () => ({
  fetchInChunks: async (ids: string[]) => {
    if (ids[0] === "notification-1") {
      return [{ id: "notification-1", type: "approval_requested", title: "결재", body: null, link: null, recipient_id: "user-1", actor_id: null, created_at: "2026-11-12T00:00:00.000Z" }];
    }
    if (ids[0] === "user-1") return [{ id: "user-1", display_name: "김원장" }];
    return [];
  },
}));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettingsByTenantId: async () => ({ operations: { subjects: [] } }) }));
vi.mock("@/features/owner/subjects", () => ({ buildSubjectMaps: () => ({ labelOf: () => "" }) }));
vi.mock("./store", () => ({
    loadLinks: async () => new Map(),
    loadRules: async () => ({
      status: "ok",
      value: [{
        id: "rule-1", name: "결재", enabled: true, source: "notification", typeKeys: ["approval_requested"],
        targets: [{ kind: "channel", channelId: "C1234567", channelName: "운영" }], template: "short",
        mentionRecipients: false, ping: "none", actorIds: [], excludeActorIds: [], timing: "immediate",
        digestAt: null, honorDnd: true, version: 1,
      }],
    }),
}));

function inboxRead() {
  const q = { select: vi.fn(), update: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn(), in: vi.fn() };
  q.select.mockReturnValue(q);
  q.update.mockReturnValue(q);
  q.eq.mockReturnValue(q);
  q.order.mockReturnValue(q);
  q.limit.mockResolvedValue({ data: [{ id: 1, source: "notification", source_id: "notification-1" }], error: null });
  q.in.mockResolvedValue({ error: null });
  return q;
}

function outboxTable() {
  const q = { upsert: mocks.upsert, update: mocks.outboxUpdate, eq: vi.fn(), in: vi.fn() };
  mocks.outboxUpdate.mockReturnValue(q);
  q.eq.mockReturnValue(q);
  q.in.mockResolvedValue({ error: null });
  return q;
}

const conn: SlackConnection = {
  botToken: "token", teamName: "팀", teamId: "T1", botUserId: "B1", status: "active",
  dndEnabled: false, dndStart: "22:00", dndEnd: "08:00", weekendQuiet: false, digestAt: "08:00",
  lastDispatchAt: null, lastErrorCode: null, lastErrorAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.upsert.mockResolvedValue({ error: null });
  mocks.from.mockImplementation((table: string) => {
    if (table === "slack_inbox") return inboxRead();
    if (table === "slack_outbox") return outboxTable();
    throw new Error(`예상하지 않은 표: ${table}`);
  });
});

it("아웃박스를 만들기 직전 라이선스가 꺼져 있으면 인박스를 대기로 두고 만들지 않는다", async () => {
  mocks.optedIn.mockResolvedValue(false);
  const expanded = await expandInbox("tenant", conn, null, new Date("2026-11-12T00:01:00.000Z"));
  expect(expanded).toBe(0);
  expect(mocks.upsert).not.toHaveBeenCalled();
  expect(mocks.from).toHaveBeenCalledTimes(1);
});

it("아웃박스 생성 뒤 라이선스 조회가 실패하면 만든 줄을 취소하지 않는다", async () => {
  mocks.optedIn.mockResolvedValue(true);
  mocks.optedInState.mockResolvedValue("unknown");

  await expect(expandInbox("tenant", conn, null, new Date("2026-11-12T00:01:00.000Z"))).resolves.toBe(1);

  expect(mocks.upsert).toHaveBeenCalledOnce();
  expect(mocks.outboxUpdate).not.toHaveBeenCalled();
});

it("아웃박스 생성 뒤 라이선스가 명시로 꺼졌으면 만든 줄을 취소한다", async () => {
  mocks.optedIn.mockResolvedValue(true);
  mocks.optedInState.mockResolvedValue("disabled");

  await expect(expandInbox("tenant", conn, null, new Date("2026-11-12T00:01:00.000Z"))).resolves.toBe(0);

  expect(mocks.upsert).toHaveBeenCalledOnce();
  expect(mocks.outboxUpdate).toHaveBeenCalledWith({ status: "cancelled", last_error_code: "지점 슬랙 꺼짐" });
});
