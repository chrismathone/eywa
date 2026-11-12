import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  viewer: vi.fn(),
  available: vi.fn(),
  notices: vi.fn(),
  admin: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("./parent-viewer", () => ({ getParentViewer: mocks.viewer }));
vi.mock("./parent-availability", () => ({
  PARENT_PORTAL_UNAVAILABLE_MESSAGE: "지금은 이용할 수 있는 화면이 없습니다",
  parentPortalAvailable: mocks.available,
}));
vi.mock("./parent-departure", () => ({ loadParentNotices: mocks.notices }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));

import { ackParentNotice } from "./parent-departure-actions";

describe("학부모 알림 확인 쓰기 문", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.viewer.mockResolvedValue({ parentAccountId: "p1", tenantId: "t1", displayName: "보호자", children: [] });
  });

  it("포털 이용 불가 상태면 알림 확인 행을 쓰지 않는다", async () => {
    mocks.available.mockResolvedValue(false);
    await expect(ackParentNotice("run-1", "depart")).resolves.toEqual({
      error: "지금은 이용할 수 있는 화면이 없습니다",
    });
    expect(mocks.notices).not.toHaveBeenCalled();
    expect(mocks.admin).not.toHaveBeenCalled();
  });
});
