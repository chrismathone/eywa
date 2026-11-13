import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { isMobileCameraDevice, useMobileCamera } from "./use-mobile-camera";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const nav = (userAgent: string, platform = "", maxTouchPoints = 0) => ({
  userAgent, platform, maxTouchPoints,
  mediaDevices: { getUserMedia: vi.fn(), enumerateDevices: vi.fn().mockResolvedValue([{ kind: "videoinput" }]) } as unknown as MediaDevices,
});
it("아이폰·안드로이드·데스크톱 UA의 아이패드만 지원하고 PC 웹캠은 숨긴다", () => {
  expect(isMobileCameraDevice(nav("iPhone"))).toBe(true);
  expect(isMobileCameraDevice(nav("Android"))).toBe(true);
  expect(isMobileCameraDevice(nav("Macintosh", "MacIntel", 5))).toBe(true);
  expect(isMobileCameraDevice(nav("Windows", "Win32", 10))).toBe(false);
  expect(isMobileCameraDevice(nav("Macintosh", "MacIntel", 0))).toBe(false);
  expect(isMobileCameraDevice({ ...nav("iPhone"), mediaDevices: undefined as unknown as MediaDevices })).toBe(false);
});
it("표시 여부를 확인할 때 카메라 권한을 요청하지 않는다", async () => {
  const navigator = nav("iPhone");
  vi.stubGlobal("navigator", navigator);
  const { result } = renderHook(useMobileCamera);
  await waitFor(() => expect(result.current).toBe(true));
  expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
});
it("카메라가 없는 모바일은 숨기고 권한 전 빈 목록은 명시적 버튼으로 확인한다", async () => {
  const navigator = nav("Android");
  vi.mocked(navigator.mediaDevices.enumerateDevices).mockResolvedValue([{ kind: "audioinput" }] as MediaDeviceInfo[]);
  vi.stubGlobal("navigator", navigator);
  const first = renderHook(useMobileCamera);
  await waitFor(() => expect(navigator.mediaDevices.enumerateDevices).toHaveBeenCalled());
  expect(first.result.current).toBe(false);
  first.unmount();
  vi.mocked(navigator.mediaDevices.enumerateDevices).mockResolvedValue([]);
  const second = renderHook(useMobileCamera);
  await waitFor(() => expect(second.result.current).toBe(true));
});
