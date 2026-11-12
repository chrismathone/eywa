import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@/features/owner/server/queries", () => ({ loadTenantSettingsRaw: mocks.load }));

import { parentPortalAvailable } from "./parent-availability";

const viewer = { tenantId: "tenant-1" };

describe("학부모 포털 이용 가능 상태", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("침산 조건(설정 행 없음)은 종전처럼 셔틀이 켜진다", async () => {
    mocks.load.mockResolvedValue({ data: null, name: "인재원 침산" });
    await expect(parentPortalAvailable(viewer)).resolves.toBe(true);
  });

  it("셔틀 모듈을 명시로 켠 일반판은 열린다", async () => {
    mocks.load.mockResolvedValue({
      data: { version: 1, preset: "generic", modules: { disabled: ["inventory"] } },
      name: "테스트 학원",
    });
    await expect(parentPortalAvailable(viewer)).resolves.toBe(true);
  });

  it("셔틀 모듈을 끈 일반판은 닫힌다", async () => {
    mocks.load.mockResolvedValue({
      data: { version: 1, preset: "generic", modules: { disabled: ["shuttle"] } },
      name: "테스트 학원",
    });
    await expect(parentPortalAvailable(viewer)).resolves.toBe(false);
  });

  it("설정을 읽지 못하거나 판정 중 예외가 나면 외부 표면을 닫는다", async () => {
    mocks.load.mockResolvedValueOnce({ data: null, name: "", failed: true });
    await expect(parentPortalAvailable(viewer)).resolves.toBe(false);

    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.load.mockRejectedValueOnce(new Error("db down"));
    await expect(parentPortalAvailable(viewer)).resolves.toBe(false);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
