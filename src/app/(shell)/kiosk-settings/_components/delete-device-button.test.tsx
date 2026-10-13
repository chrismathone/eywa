/** 키오스크 기기 삭제(원장 2026-10-13) — 되돌릴 수 없어 확인을 거친다. 취소하면 서버 액션이 불리지 않는다. */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const deleteKioskDevice = vi.fn(async () => ({ ok: "기기를 삭제했습니다." }));
vi.mock("@/features/attendance/kiosk/server/actions", () => ({
  deleteKioskDevice: (...args: unknown[]) => deleteKioskDevice(...(args as [])),
  assignAttendanceCodesAction: vi.fn(),
  registerKioskDevice: vi.fn(),
  revokeKioskDevice: vi.fn(),
  saveKakaoChannel: vi.fn(),
  sendTestAlimtalk: vi.fn(),
}));

import { DeleteDeviceButton } from "./forms";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  deleteKioskDevice.mockClear();
});

describe("키오스크 기기 삭제 버튼", () => {
  it("확인창에 기기 번호·이름을 적고, 취소하면 삭제하지 않는다", async () => {
    const ask = vi.fn<(message?: string) => boolean>(() => false);
    vi.stubGlobal("confirm", ask);
    render(<DeleteDeviceButton deviceId="d1" label="기기 #2 키오스크" />);
    fireEvent.click(screen.getByRole("button", { name: "삭제" }));
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask.mock.calls[0][0]).toContain("기기 #2 키오스크");
    await new Promise((r) => setTimeout(r, 20));
    expect(deleteKioskDevice).not.toHaveBeenCalled();
  });

  it("확인하면 그 기기 id로 삭제를 요청한다", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    render(<DeleteDeviceButton deviceId="d1" label="기기 #1 키오스크" />);
    fireEvent.click(screen.getByRole("button", { name: "삭제" }));
    await waitFor(() => expect(deleteKioskDevice).toHaveBeenCalledTimes(1));
    const form = (deleteKioskDevice.mock.calls[0] as unknown[])[1] as FormData;
    expect(form.get("deviceId")).toBe("d1");
  });
});
