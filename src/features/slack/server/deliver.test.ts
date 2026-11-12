import { beforeEach, expect, it, vi } from "vitest";
import { deliverDue } from "./deliver";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  optedIn: vi.fn(),
  postMessage: vi.fn(),
  writes: [] as { patch: Record<string, unknown>; filters: [string, unknown][] }[],
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: mocks.from }) }));
vi.mock("@/lib/license/server", () => ({ isFeatureOptedInFresh: mocks.optedIn }));
vi.mock("./client", () => ({
  slackPostMessage: mocks.postMessage,
  slackPostDm: vi.fn(),
}));

const row = {
  id: "outbox-1",
  target: { kind: "channel", channelId: "C1234567" },
  kind: "message",
  body: "본문",
  group_label: "알림",
  created_at: "2026-11-12T00:00:00.000Z",
  due_at: "2026-11-12T00:00:00.000Z",
  attempt_count: 0,
};
const quiet = { dndEnabled: false, dndStart: "22:00", dndEnd: "08:00", weekendQuiet: false };

function readQuery() {
  const q = {
    select: vi.fn(), eq: vi.fn(), lte: vi.fn(), order: vi.fn(), limit: vi.fn(),
  };
  q.select.mockReturnValue(q);
  q.eq.mockReturnValue(q);
  q.lte.mockReturnValue(q);
  q.order.mockReturnValue(q);
  q.limit.mockResolvedValue({ data: [row], error: null });
  return q;
}

function writeQuery() {
  const filters: [string, unknown][] = [];
  const q = {
    update: vi.fn((patch: Record<string, unknown>) => {
      mocks.writes.push({ patch, filters });
      return q;
    }),
    eq: vi.fn((column: string, value: unknown) => {
      filters.push([column, value]);
      return q;
    }),
    in: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
  return q;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.writes = [];
  mocks.from.mockReturnValueOnce(readQuery()).mockImplementation(() => writeQuery());
});

it("HTTP 요청 직전 라이선스가 꺼져 있으면 보내지 않는다", async () => {
  mocks.optedIn.mockResolvedValue(false);
  const result = await deliverDue("tenant", "token", new Date("2026-11-12T00:01:00.000Z"), Date.now() + 10_000, quiet);
  expect(result).toEqual({ sent: 0, authError: null });
  expect(mocks.postMessage).not.toHaveBeenCalled();
  expect(mocks.writes).toHaveLength(0);
});

it("발송 결과는 아직 pending인 줄에만 기록해 먼저 된 취소를 덮지 않는다", async () => {
  mocks.optedIn.mockResolvedValue(true);
  mocks.postMessage.mockResolvedValue({ ok: true, channel: "C1234567", ts: "1.2" });
  const result = await deliverDue("tenant", "token", new Date("2026-11-12T00:01:00.000Z"), Date.now() + 10_000, quiet);
  expect(result.sent).toBe(1);
  expect(mocks.writes[0].patch).toMatchObject({ status: "sent", slack_ts: "1.2" });
  expect(mocks.writes[0].filters).toContainEqual(["status", "pending"]);
});
