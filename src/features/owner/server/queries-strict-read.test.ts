import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTenantSettingsByTenantId } from "./queries";

const bag = vi.hoisted(() => ({ error: null as { message: string } | null, stored: { operations: { holidays: [] } }, resolve: vi.fn() }));
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("./platform-settings", () => ({ platformAccountIds: vi.fn() }));
vi.mock("../resolve", () => ({ resolveSettings: bag.resolve }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  from: (table: string) => {
    const query = { select: () => query, eq: () => query,
      maybeSingle: async () => table === "tenant_settings"
        ? { data: { data: bag.stored }, error: bag.error }
        : { data: { name: "합성 학원" }, error: null } };
    return query;
  },
}) }));

describe("설정 읽기 성공이 필요한 소비처", () => {
  beforeEach(() => { bag.error = null; bag.resolve.mockReset(); vi.spyOn(console, "error").mockImplementation(() => {}); });
  afterEach(() => vi.restoreAllMocks());
  it("엄격한 조회 실패는 기본값을 해석하지 않고 실패를 전달한다", async () => {
    bag.error = { message: "synthetic read error" };
    await expect(getTenantSettingsByTenantId("tenant-a", { failOnReadError: true })).rejects.toThrow("학원 설정을 확인하지 못했습니다");
    expect(bag.resolve).not.toHaveBeenCalled();
  });
  it("기존 호출은 조회 실패 시 기본값 규약을 유지한다", async () => {
    bag.error = { message: "synthetic read error" };
    await getTenantSettingsByTenantId("tenant-a");
    expect(bag.resolve).toHaveBeenCalledWith({}, { name: "합성 학원" });
  });
  it("엄격한 조회 성공은 같은 저장값과 정식 해석기를 사용한다", async () => {
    await getTenantSettingsByTenantId("tenant-a", { failOnReadError: true });
    expect(bag.resolve).toHaveBeenCalledWith(bag.stored, { name: "합성 학원" });
  });
});
