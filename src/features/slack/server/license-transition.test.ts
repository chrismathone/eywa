import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SLACK_LICENSE_CLOSE_REASON,
  closePendingSlackWork,
  keySinceAt,
  resetEnabledRuleWindows,
  slackLicenseTransition,
} from "./license-transition";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rules: [] as { id: string; type_keys: string[]; version: number; enabled: boolean }[],
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: mocks.from }) }));
vi.mock("@/lib/supabase/batch", () => ({ fetchAllPaged: async () => mocks.rules }));

type Chain = {
  update: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  then: PromiseLike<unknown>["then"];
};

function chain(result: { data?: unknown[] | null; count?: number | null; error: unknown }): Chain {
  const q = {} as Chain;
  q.update = vi.fn(() => q);
  q.eq = vi.fn(() => q);
  q.select = vi.fn(() => q);
  q.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return q;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rules = [];
});

describe("슬랙 라이선스 전환", () => {
  it("켜진 상태를 다시 저장하면 전환이 아니므로 규칙과 대기를 건드릴 계획이 없다", () => {
    expect(slackLicenseTransition(true, true)).toBe("unchanged");
    expect(slackLicenseTransition(false, true)).toBe("enable");
    expect(slackLicenseTransition(true, false)).toBe("disable");
  });

  it("대기 인박스는 건너뜀, 아웃박스는 사유를 남겨 취소한다", async () => {
    const inbox = chain({ count: 3, error: null });
    const outbox = chain({ count: 2, error: null });
    mocks.from.mockImplementation((table: string) => (table === "slack_inbox" ? inbox : outbox));

    await expect(closePendingSlackWork("tenant", "2026-11-12T00:00:00.000Z")).resolves.toEqual({
      inboxSkipped: 3,
      outboxCancelled: 2,
    });
    expect(inbox.update).toHaveBeenCalledWith(
      { status: "skipped", processed_at: "2026-11-12T00:00:00.000Z" },
      { count: "exact" },
    );
    expect(outbox.update).toHaveBeenCalledWith(
      { status: "cancelled", last_error_code: SLACK_LICENSE_CLOSE_REASON },
      { count: "exact" },
    );
  });

  it("다시 켤 때 켜진 규칙의 모든 키를 지금으로 밀고 version도 올린다", async () => {
    mocks.rules = [{ id: "rule-1", type_keys: ["a", "b"], version: 7, enabled: true }];
    const rule = chain({ data: [{ id: "rule-1" }], error: null });
    mocks.from.mockReturnValue(rule);
    const now = "2026-11-12T00:00:00.000Z";

    await expect(resetEnabledRuleWindows("tenant", now)).resolves.toEqual({ rulesReset: 1 });
    expect(rule.update).toHaveBeenCalledWith({
      key_since: keySinceAt(["a", "b"], now),
      version: 8,
      updated_at: now,
    });
    expect(rule.eq).toHaveBeenCalledWith("version", 7);
  });
});
