import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  eieOn: vi.fn(),
  month: vi.fn(),
  chrome: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("./eie-on", () => ({ eieModuleOn: () => m.eieOn() }));
vi.mock("./month-queries", () => ({ getClassSheetMonth: (...args: unknown[]) => m.month(...args) }));
vi.mock("./month-plan-chrome", () => ({ getMonthPlanChrome: (...args: unknown[]) => m.chrome(...args) }));

import { getMonthPlanPrint } from "./month-plan-print";

beforeEach(() => {
  m.eieOn.mockReset();
  m.month.mockReset();
  m.chrome.mockReset();
  m.eieOn.mockResolvedValue(true);
  m.month.mockResolvedValue({ ok: true, data: { isEie: true, month: "2026-11", teacherId: "teacher-1" } });
  m.chrome.mockResolvedValue({ texts: {}, teacherLabel: "강사", periodRange: "11월" });
});

describe("EiE 월간 계획서 인쇄 게이트", () => {
  it("EiE 모듈이 꺼진 지점만 404 사유로 구분한다", async () => {
    m.eieOn.mockResolvedValue(false);
    await expect(getMonthPlanPrint("class-1", "2026-11")).resolves.toMatchObject({
      ok: false,
      reason: "module_disabled",
    });
    expect(m.chrome).not.toHaveBeenCalled();
  });

  it("권한·조회 오류는 404 사유로 바꾸지 않는다", async () => {
    m.month.mockResolvedValue({ ok: false, error: "이 반을 볼 권한이 없습니다" });
    await expect(getMonthPlanPrint("class-1", "2026-11")).resolves.toEqual({
      ok: false,
      error: "이 반을 볼 권한이 없습니다",
    });
  });

  it("모듈이 켜진 EiE 반은 종전 인쇄 자료를 만든다", async () => {
    await expect(getMonthPlanPrint("class-1", "2026-11", "session")).resolves.toMatchObject({
      ok: true,
      data: { teacherLabel: "강사", periodRange: "11월" },
    });
    expect(m.month).toHaveBeenCalledWith("class-1", "2026-11", { period: "session" });
  });
});
