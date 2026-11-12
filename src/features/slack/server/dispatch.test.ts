import { beforeEach, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  optedIn: vi.fn(),
  loadConnection: vi.fn(),
  acquireLease: vi.fn(),
  releaseLease: vi.fn(),
  reconcileInbox: vi.fn(),
}));

vi.mock("@/lib/license/server", () => ({ isFeatureOptedIn: fakes.optedIn }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/features/audit/server/log", () => ({ logActionAs: vi.fn() }));
vi.mock("@/features/notifications/server/notify", () => ({ notifyUsers: vi.fn() }));
vi.mock("@/lib/observability/report-error", () => ({ reportError: vi.fn() }));
vi.mock("./deliver", () => ({ deliverDue: vi.fn() }));
vi.mock("./expand", () => ({ expandInbox: vi.fn() }));
vi.mock("./reconcile", () => ({ reconcileInbox: fakes.reconcileInbox }));
vi.mock("./store", () => ({ loadConnection: fakes.loadConnection }));
vi.mock("./license-transition", () => ({
  acquireSlackMaintenanceLease: fakes.acquireLease,
  releaseSlackMaintenanceLease: fakes.releaseLease,
}));

import { drainTenant } from "./dispatch";

const brokenConnection = {
  botToken: "token",
  teamName: "팀",
  teamId: "T1",
  botUserId: "B1",
  status: "broken" as const,
  dndEnabled: false,
  dndStart: "22:00",
  dndEnd: "08:00",
  weekendQuiet: false,
  digestAt: "08:00",
  lastDispatchAt: null,
  lastErrorCode: "invalid_auth",
  lastErrorAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  fakes.optedIn.mockResolvedValue(true);
  fakes.loadConnection.mockResolvedValue({ status: "ok", value: brokenConnection });
  fakes.releaseLease.mockResolvedValue(undefined);
  fakes.reconcileInbox.mockResolvedValue(0);
});

it("끊긴 연결의 유실 대조는 정비 리스를 못 잡으면 건너뛴다", async () => {
  fakes.acquireLease.mockResolvedValue({ leaseId: null, error: "슬랙 발송 정리가 진행 중입니다" });

  await expect(drainTenant("tenant", { reconcile: true })).resolves.toBeNull();

  expect(fakes.reconcileInbox).not.toHaveBeenCalled();
  expect(fakes.releaseLease).not.toHaveBeenCalled();
});

it("끊긴 연결의 유실 대조는 잡은 정비 리스를 끝까지 유지한다", async () => {
  fakes.acquireLease.mockResolvedValue({ leaseId: "lease" });

  await expect(drainTenant("tenant", { reconcile: true })).resolves.toBeNull();

  expect(fakes.reconcileInbox).toHaveBeenCalledWith("tenant", expect.any(Date));
  expect(fakes.releaseLease).toHaveBeenCalledWith("tenant", "lease");
});
