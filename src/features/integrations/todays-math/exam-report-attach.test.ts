import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rows: [] as unknown[], target: vi.fn(), from: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const chain: Record<string, unknown> = {};
    for (const k of ["select", "eq"]) chain[k] = () => chain;
    chain.limit = async () => ({ data: mocks.rows, error: null });
    return { from: (t: string) => { mocks.from(t); return chain; }, rpc: vi.fn(), storage: { from: vi.fn() } };
  },
}));
vi.mock("@/lib/license/server", () => ({ isFeatureOptedIn: async () => true }));
vi.mock("./sync-server", () => ({
  sourceBindingForTenant: () => ({ bindingId: "11111111-1111-4111-8111-111111111111", tenantId: "t" }),
  targetRequest: mocks.target, targetRequestPdf: vi.fn(),
}));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettingsByTenantId: vi.fn() }));
vi.mock("@/features/notifications/server/notify", () => ({ notifyUsers: vi.fn() }));
vi.mock("@/lib/storage/media-storage", () => ({ removeObject: vi.fn() }));

import { attachExamReportBeforeSend } from "./exam-report-attach";

const args = { tenantId: "t", studentId: "s", classId: "c", reportDate: "2026-10-20", enabled: true };
beforeEach(() => { mocks.rows = []; mocks.target.mockReset(); mocks.from.mockReset(); });

describe("발송 직전 성적표 첨부", () => {
  it("토글이 꺼져 있으면 DB도 안 본다", async () => {
    expect(await attachExamReportBeforeSend({ ...args, enabled: false })).toBe("skipped");
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("그날 그 반 월말평가 결과가 없으면 오늘 수학에 묻지 않는다", async () => {
    expect(await attachExamReportBeforeSend(args)).toBe("skipped");
    expect(mocks.target).not.toHaveBeenCalled();
  });
  it("오늘 수학이 실패해도 발송을 막지 않는다(skipped)", async () => {
    mocks.rows = [{ source_test_id: "x" }];
    mocks.target.mockRejectedValue(new Error("target_unavailable"));
    expect(await attachExamReportBeforeSend(args)).toBe("skipped");
  });
  it("확정 성적표가 아직 없으면 그냥 지나간다", async () => {
    mocks.rows = [{ source_test_id: "x" }];
    mocks.target.mockResolvedValue({ version: "v1", bindingId: "11111111-1111-4111-8111-111111111111", date: "2026-10-20", availability: "ready", reports: [] });
    expect(await attachExamReportBeforeSend(args)).toBe("skipped");
  });
});
