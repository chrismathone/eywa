// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ optedIn: vi.fn() }));
vi.mock("@/lib/license/server", () => ({ isFeatureOptedIn: m.optedIn }));
import { ManagementInputError } from "../errors";
import { accountingImportAllowed, requireAccountingImport } from "./accounting-scope";

beforeEach(() => vi.clearAllMocks());
it("지점 스위치가 켜진 지점만 회계 자료를 올린다(운영 콘솔 ecount_accounting · 줄 없음 = 꺼짐)", async () => {
  m.optedIn.mockResolvedValue(true);
  await expect(requireAccountingImport("t1")).resolves.toBeUndefined();
  expect(m.optedIn).toHaveBeenCalledWith("t1", "ecount_accounting");
  m.optedIn.mockResolvedValue(false);
  expect(await accountingImportAllowed("t2")).toBe(false);
  await expect(requireAccountingImport("t2")).rejects.toBeInstanceOf(ManagementInputError);
  await expect(requireAccountingImport("t2")).rejects.toThrow("운영사에 문의");
});
