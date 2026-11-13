import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { isMobileCameraDevice, useMobileCamera } from "./use-mobile-camera";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const nav = (userAgent: string, platform = "", maxTouchPoints = 0) => ({
  userAgent, platform, maxTouchPoints,
  mediaDevices: { getUserMedia: vi.fn(), enumerateDevices: vi.fn().mockResolvedValue([{ kind: "videoinput" }]) } as unknown as MediaDevices,
});
it("아이폰·안드로이드·아이패드를 지원하고 일반 PC 웹캠은 숨긴다", () => {
  expect(isMobileCameraDevice(nav("iPhone"))).toBe(true);
  expect(isMobileCameraDevice(nav("Android"))).toBe(true);
  expect(isMobileCameraDevice(nav("Macintosh", "MacIntel", 5))).toBe(true);
  expect(isMobileCameraDevice(nav("Windows", "Win32", 10))).toBe(false);
  expect(isMobileCameraDevice(nav("Macintosh", "MacIntel", 0))).toBe(false);
  expect(isMobileCameraDevice(nav("Macintosh", "iPhone", 5))).toBe(true);
});
it("기기 이름까지 PC처럼 바뀌어도 휴대폰의 터치 입력으로 판정한다", () => {
  expect(isMobileCameraDevice(nav("X11; Linux x86_64", "Linux aarch64", 5), true)).toBe(true);
  expect(isMobileCameraDevice(nav("X11; Linux x86_64", "Linux aarch64", 5), false)).toBe(false);
  expect(isMobileCameraDevice(nav("Windows", "Win32", 0), true)).toBe(false);
});
it("표시 여부를 확인할 때 카메라 권한이나 기기 목록을 요청하지 않는다", async () => {
  const navigator = nav("iPhone");
  vi.stubGlobal("navigator", navigator);
  const { result } = renderHook(useMobileCamera);
  await waitFor(() => expect(result.current).toBe(true));
  expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  expect(navigator.mediaDevices.enumerateDevices).not.toHaveBeenCalled();
});
it("권한 전 카메라 목록이 비어 있거나 오디오만 보여도 버튼을 숨기지 않는다", async () => {
  const navigator = nav("Android");
  vi.mocked(navigator.mediaDevices.enumerateDevices).mockResolvedValue([{ kind: "audioinput" }] as MediaDeviceInfo[]);
  vi.stubGlobal("navigator", navigator);
  const first = renderHook(useMobileCamera);
  await waitFor(() => expect(first.result.current).toBe(true));
  first.unmount();
  vi.mocked(navigator.mediaDevices.enumerateDevices).mockResolvedValue([]);
  const second = renderHook(useMobileCamera);
  await waitFor(() => expect(second.result.current).toBe(true));
  expect(navigator.mediaDevices.enumerateDevices).not.toHaveBeenCalled();
});
it("실시간 카메라 API가 없는 모바일도 기본 카메라·사진 선택 경로를 열 수 있다", async () => {
  vi.stubGlobal("navigator", { userAgent: "iPhone", platform: "iPhone", maxTouchPoints: 5 });
  const { result } = renderHook(useMobileCamera);
  await waitFor(() => expect(result.current).toBe(true));
});
it("PC 보기 상태인 휴대폰은 표시하고 좁은 PC 브라우저는 계속 숨긴다", async () => {
  vi.stubGlobal("navigator", nav("X11; Linux x86_64", "Linux aarch64", 5));
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(any-pointer: coarse)", addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const phone = renderHook(useMobileCamera);
  await waitFor(() => expect(phone.result.current).toBe(true));
  phone.unmount();
  vi.stubGlobal("navigator", nav("Windows", "Win32", 0));
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(any-pointer: fine)", addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const pc = renderHook(useMobileCamera);
  expect(pc.result.current).toBe(false);
});
