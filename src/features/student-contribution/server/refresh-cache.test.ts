import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ refresh: vi.fn(), gate: vi.fn(), update: vi.fn(), revalidate: vi.fn(), doneToday: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: mock.update, revalidateTag: mock.revalidate }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/features/audit/server/log", () => ({ logAction: vi.fn(), logActionAs: vi.fn() }));
vi.mock("@/lib/laboratory/server", () => ({ isLaboratoryMenuAvailable: async () => true }));
vi.mock("./access", () => ({ requireContributionWrite: mock.gate }));
vi.mock("./queries", () => ({ getContributionList: vi.fn() }));
vi.mock("./refresh", () => ({ refreshStudentContribution: mock.refresh }));
vi.mock("./refresh-limit", () => ({ manualRefreshDoneToday: mock.doneToday }));
vi.mock("./snapshot-cache", () => ({ contributionSnapshotTag: (tenant: string) => `student-contribution-snapshot:${tenant}` }));
import { refreshContribution } from "./actions";
import { GET } from "@/app/api/cron/student-contribution/route";
beforeEach(() => {
  vi.clearAllMocks();
  mock.gate.mockResolvedValue({ tenantId: "t" });
  mock.doneToday.mockResolvedValue(null);
  mock.refresh.mockResolvedValue({ written: 1, students: 1, closed: 0, complete: true });
  vi.stubEnv("CRON_SECRET", "test-cron-secret");
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
it("수동 집계 성공·부분 실패 모두 월 기록 캐시를 즉시 만료한다", async () => {
  await refreshContribution();
  expect(mock.update).toHaveBeenLastCalledWith("student-contribution-snapshot:t");
  mock.refresh.mockRejectedValueOnce(new Error("partial save"));
  expect(await refreshContribution()).toEqual({ error: "partial save" });
  expect(mock.update).toHaveBeenCalledTimes(2);
});
it("쓰기 권한 거부 시 집계와 캐시 무효화를 실행하지 않는다", async () => {
  mock.gate.mockRejectedValueOnce(new Error("denied"));
  expect(await refreshContribution()).toEqual({ error: "denied" });
  expect(mock.refresh).not.toHaveBeenCalled();
  expect(mock.update).not.toHaveBeenCalled();
});
it("밤 배치의 실패도 만료하고 인증 실패는 집계에 도달하지 않는다", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const request = () => new Request("http://localhost/api/cron/student-contribution", { headers: { authorization: "Bearer test-cron-secret" } });
  expect((await GET(request())).status).toBe(200);
  expect(mock.revalidate).toHaveBeenCalledWith(expect.stringContaining("student-contribution-snapshot:"), { expire: 0 });
  mock.refresh.mockRejectedValueOnce(new Error("partial save"));
  expect((await GET(request())).status).toBe(500);
  expect(mock.revalidate).toHaveBeenCalledTimes(2);
  expect((await GET(new Request("http://localhost/api/cron/student-contribution"))).status).toBe(401);
  expect(mock.refresh).toHaveBeenCalledTimes(2);
  expect(mock.revalidate).toHaveBeenCalledTimes(2);
});

it("직접 집계는 하루 1회 — 오늘 끝까지 마친 직접 집계가 있으면 집계·캐시 만료 없이 안내만", async () => {
  mock.doneToday.mockResolvedValueOnce("10:30");
  const result = await refreshContribution();
  expect(result).toMatchObject({ error: expect.stringContaining("10:30") });
  expect(mock.refresh).not.toHaveBeenCalled();
  expect(mock.update).not.toHaveBeenCalled();
});
