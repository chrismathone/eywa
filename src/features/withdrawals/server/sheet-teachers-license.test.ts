import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSheetsApi: vi.fn(),
  getLicenseFlags: vi.fn(),
  isSheetTenant: vi.fn(),
  spreadsheetIdOf: vi.fn(),
}));

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  cache: (fn: unknown) => fn,
}));
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
vi.mock("@/features/integrations/google-sheets", () => ({ getSheetsApi: mocks.getSheetsApi }));
vi.mock("@/lib/license/server", () => ({ getLicenseFlags: mocks.getLicenseFlags }));
vi.mock("./withdrawal-sheet", () => ({
  isSheetTenant: mocks.isSheetTenant,
  spreadsheetIdOf: mocks.spreadsheetIdOf,
}));
vi.mock("@/lib/observability/report-error", () => ({ reportWarning: vi.fn() }));

import { loadSheetExits } from "./sheet-teachers";

function sheetsApi() {
  return {
    spreadsheets: {
      get: vi.fn().mockResolvedValue({ data: { sheets: [] } }),
      values: { batchGet: vi.fn() },
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.spreadsheetIdOf.mockReturnValue("sheet-id");
  mocks.isSheetTenant.mockResolvedValue(true);
  mocks.getLicenseFlags.mockResolvedValue({ google_sheets: true });
  mocks.getSheetsApi.mockResolvedValue(sheetsApi());
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("퇴원생 차트 구글 시트 라이선스", () => {
  it("라이선스가 꺼지면 시트를 읽지 않고 null로 돌아간다", async () => {
    mocks.getLicenseFlags.mockResolvedValue({ google_sheets: false });

    await expect(loadSheetExits("demo")).resolves.toBeNull();
    expect(mocks.getLicenseFlags).toHaveBeenCalledWith("demo");
    expect(mocks.getSheetsApi).not.toHaveBeenCalled();
  });

  it("라이선스가 켜지면 종전처럼 시트를 읽는다", async () => {
    await expect(loadSheetExits("tenant-id")).resolves.toEqual([]);
    expect(mocks.getSheetsApi).toHaveBeenCalledOnce();
  });

  it("침산도 라이선스가 켜진 경우 종전처럼 시트를 읽는다", async () => {
    await expect(loadSheetExits("cs")).resolves.toEqual([]);
    expect(mocks.getLicenseFlags).toHaveBeenCalledWith("cs");
    expect(mocks.getSheetsApi).toHaveBeenCalledOnce();
  });

  it("라이선스 조회 실패를 허용으로 접은 결과는 시트 읽기를 계속한다", async () => {
    // getLicenseFlags의 조회 실패 정책은 전부 true 반환이다. 이 입구가 그 결과를 다시 막지 않는지 고정한다.
    mocks.getLicenseFlags.mockResolvedValue({ google_sheets: true });

    await expect(loadSheetExits("tenant-id")).resolves.toEqual([]);
    expect(mocks.getSheetsApi).toHaveBeenCalledOnce();
  });
});

describe("퇴원생 차트 소비처", () => {
  const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

  it("퇴원관리와 운영실은 같은 loadSheetExits 입구를 쓴다", () => {
    expect(source("src/app/(shell)/withdrawals/page.tsx")).toContain("loadSheetExits(user.tenantId)");
    expect(source("src/features/withdrawals/server/sheet-withdrawals.ts")).toContain("loadSheetExits(tenantId)");
  });

  it("시간표 X와 강사별 퇴원율은 loadSheetTeacherIndex를 통해 같은 입구를 쓴다", () => {
    expect(source("src/features/withdrawals/server/exit-teacher-judge.ts")).toContain("loadSheetTeacherIndex(tenantId)");
    expect(source("src/features/withdrawals/server/sheet-teachers.ts")).toContain("const records = await loadSheetExits(tenantId)");
  });
});
