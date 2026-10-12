import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ run: vi.fn(), paged: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/supabase/batch", () => ({ fetchAllPaged: m.paged }));
vi.mock("@/features/video-homework/server/reconcile-outcomes", () => ({ reconcileVideoHomework: m.run }));
vi.mock("@/lib/observability/report-error", () => ({ reportError: vi.fn() }));
import { GET } from "./route";
beforeEach(() => { vi.stubEnv("CRON_SECRET", "test-secret"); vi.clearAllMocks();
  m.paged.mockResolvedValue([{ tenant_id: "a" }, { tenant_id: "a" }, { tenant_id: "b" }]);
  m.run.mockResolvedValue({ checked: 2, updated: 1, notifications: 1 }); });
afterEach(() => vi.unstubAllEnvs());
const request = (token = "test-secret") => new Request("http://localhost/api/cron/video-homework", { headers: { authorization: `Bearer ${token}` } });
it("인증 없는 요청은 영상 상태를 바꿀 수 없다", async () => {
  expect((await GET(request("wrong"))).status).toBe(401); expect(m.paged).not.toHaveBeenCalled();
  vi.stubEnv("CRON_SECRET", ""); expect((await GET(request())).status).toBe(401);
});
it("지점별로 한 번 실행하고 하나가 실패해도 나머지는 처리하며 실패를 응답한다", async () => {
  m.run.mockRejectedValueOnce(new Error("retry"));
  const response = await GET(request());
  expect(response.status).toBe(500);
  expect(m.run.mock.calls).toEqual([["a", { scheduled: true, notifyUnmatched: true }], ["b", { scheduled: true, notifyUnmatched: true }]]);
  expect(await response.json()).toMatchObject({ checked: 2, updated: 1, notifications: 1, failed: 1 });
});
