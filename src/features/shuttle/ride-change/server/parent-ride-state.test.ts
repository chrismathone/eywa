import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ viewer: vi.fn(), available: vi.fn() }));
vi.mock("../../parent/server/parent-viewer", () => ({ getParentViewer: mocks.viewer }));
vi.mock("../../parent/server/parent-availability", () => ({
  PARENT_PORTAL_UNAVAILABLE_MESSAGE: "지금은 이용할 수 있는 화면이 없습니다",
  parentPortalAvailable: mocks.available,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { kstToday } from "@/lib/date-kst";
import { parentGate } from "./parent-ride-state";

const viewer = {
  parentAccountId: "parent-1",
  tenantId: "tenant-1",
  displayName: "김보호",
  children: [{ id: "student-1", name: "김학생", schoolGrade: "초3", relationship: "보호자" }],
};

describe("학부모 등하원 쓰기 공용 문", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.viewer.mockResolvedValue(viewer);
  });

  it("포털 이용 불가 상태면 탑승 변경·결석·정기 변경 공용 문에서 거절한다", async () => {
    mocks.available.mockResolvedValue(false);
    await expect(parentGate({ studentId: "student-1", onDate: kstToday(), ioKind: "in" })).resolves.toEqual({
      error: "지금은 이용할 수 있는 화면이 없습니다",
    });
  });

  it("포털 이용 가능 상태면 종전 학부모·자녀 문맥을 돌려준다", async () => {
    mocks.available.mockResolvedValue(true);
    const result = await parentGate({ studentId: "student-1", onDate: kstToday(), ioKind: "in" });
    expect(result).toMatchObject({
      tenantId: "tenant-1",
      studentId: "student-1",
      actor: { kind: "parent", parentAccountId: "parent-1" },
    });
  });
});
