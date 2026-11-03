import { afterEach, describe, expect, it, vi } from "vitest";
import Page from "./page";
const mocks = vi.hoisted(() => ({ overview: vi.fn() }));
vi.mock("./_overview/overview-server", () => ({ OverviewDashboard: mocks.overview }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe("selected dashboard presentation", () => {
  it.each(["development", "production"])("%s에서 옛 view 주소도 같은 대시보드를 연다", async (environment) => {
    vi.stubEnv("NODE_ENV", environment);
    for (const view of [undefined, "one", "design", "rooms"]) {
      const result = await Page({ searchParams: Promise.resolve({ view } as { subject?: string }) });
      expect(result.type).toBe(mocks.overview);
    }
  });
});
