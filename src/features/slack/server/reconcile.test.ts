import { beforeEach, expect, it, vi } from "vitest";
import { reconcileInbox } from "./reconcile";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  originals: [] as Record<string, string>[],
  allPaged: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: mocks.from }) }));
vi.mock("@/lib/supabase/batch", () => ({
  fetchAllPagedInChunks: async () => mocks.originals,
  fetchAllPaged: mocks.allPaged,
}));

function rulesQuery(rows: unknown[]) {
  const q = {
    select: vi.fn(),
    eq: vi.fn(),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(resolve, reject),
  };
  q.select.mockReturnValue(q);
  q.eq.mockReturnValue(q);
  return q;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.originals = [];
});

it("스위치를 다시 켠 시각보다 오래된 원본은 유실 대조 인박스에 넣지 않는다", async () => {
  const enabledAt = "2026-11-12T00:10:00.000Z";
  mocks.from.mockReturnValue(
    rulesQuery([{
      source: "notification",
      type_keys: ["approval_requested"],
      key_since: { approval_requested: enabledAt },
      created_at: "2026-11-01T00:00:00.000Z",
    }]),
  );
  mocks.originals = [{
    id: "old-event",
    type: "approval_requested",
    created_at: "2026-11-12T00:05:00.000Z",
  }];

  await expect(reconcileInbox("tenant", new Date("2026-11-12T00:20:00.000Z"))).resolves.toBe(0);
  expect(mocks.allPaged).not.toHaveBeenCalled();
  expect(mocks.from).toHaveBeenCalledTimes(1);
});
