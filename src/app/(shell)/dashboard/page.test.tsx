import { afterEach, describe, expect, it, vi } from "vitest";
import Page from "./page";
const mocks = vi.hoisted(() => ({ loadRooms: vi.fn().mockResolvedValue({}), rooms: vi.fn(), overview: vi.fn() }));
vi.mock("./_overview/overview-server", () => ({ OverviewDashboard: mocks.overview }));
vi.mock("./_classrooms/classrooms", () => ({ ClassroomPreview: mocks.rooms }));
vi.mock("@/features/dashboard/classroom-preview/server", () => ({ loadClassroomPreview: mocks.loadRooms }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe("selected dashboard presentation", () => {
  it.each(["development", "production"])("%s에서 기본·one·design 주소가 같은 대시보드를 연다", async (environment) => {
    vi.stubEnv("NODE_ENV", environment);
    for (const view of [undefined, "one", "design"]) {
      const result = await Page({ searchParams: Promise.resolve({ view }) });
      expect(result.type).toBe(mocks.overview);
    }
    expect(mocks.loadRooms).not.toHaveBeenCalled();
  });
  it("강의실 2D/3D 주소는 별도로 유지한다", async () => {
    const result = await Page({ searchParams: Promise.resolve({ view: "rooms" }) });
    expect(result.type).toBe(mocks.rooms);
    expect(mocks.loadRooms).toHaveBeenCalledTimes(1);
  });
});
