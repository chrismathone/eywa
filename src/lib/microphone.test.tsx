import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMicrophone } from "@/components/forms/use-microphone";
import { microphoneErrorMessage, refreshMicrophone } from "./microphone";

let media: EventTarget & { enumerateDevices: ReturnType<typeof vi.fn>; getUserMedia: ReturnType<typeof vi.fn> };
let permission: EventTarget & { state: PermissionState };
const devices = [{ kind: "audioinput" } as MediaDeviceInfo];
beforeEach(() => {
  media = Object.assign(new EventTarget(), { enumerateDevices: vi.fn(async () => devices), getUserMedia: vi.fn() });
  permission = Object.assign(new EventTarget(), { state: "prompt" as PermissionState });
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: media });
  Object.defineProperty(navigator, "permissions", { configurable: true, value: { query: vi.fn(async () => permission) } });
  vi.stubGlobal("MediaRecorder", class {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("microphone discovery", () => {
  it("disables missing microphones and immediately enables on devicechange without acquiring audio", async () => {
    media.enumerateDevices.mockResolvedValue([]);
    const hook = renderHook(useMicrophone);
    await waitFor(() => expect(hook.result.current.message).toBe("마이크를 연결해 주세요"));
    expect(hook.result.current.available).toBe(false);
    media.enumerateDevices.mockResolvedValue(devices);
    await act(async () => { media.dispatchEvent(new Event("devicechange")); });
    expect(hook.result.current.available).toBe(true);
    expect(hook.result.current.message).toBe("");
    await act(async () => { media.enumerateDevices.mockResolvedValue([]); media.dispatchEvent(new Event("devicechange")); });
    expect(hook.result.current.available).toBe(false);
    expect(media.getUserMedia).not.toHaveBeenCalled();
  });

  it("distinguishes denied permission and responds to a permission change", async () => {
    permission.state = "denied";
    const hook = renderHook(useMicrophone);
    await waitFor(() => expect(hook.result.current.message).toContain("사용을 허용"));
    expect(hook.result.current.available).toBe(false);
    await act(async () => { permission.state = "granted"; permission.dispatchEvent(new Event("change")); });
    expect(hook.result.current.available).toBe(true);
  });

  it("does not let a stale absent-device result overwrite a more recent connection", async () => {
    const hook = renderHook(useMicrophone);
    await waitFor(() => expect(hook.result.current.available).toBe(true));
    let old!: (value: MediaDeviceInfo[]) => void;
    media.enumerateDevices.mockImplementationOnce(() => new Promise((resolve) => { old = resolve; }));
    const earlier = refreshMicrophone();
    for (let i = 0; i < 8; i++) await Promise.resolve();
    await act(async () => { await refreshMicrophone(); old([]); await earlier; });
    expect(hook.result.current.available).toBe(true);
  });

  it("uses focus to refresh devices when a browser delayed devicechange", async () => {
    media.enumerateDevices.mockResolvedValue([]);
    const hook = renderHook(useMicrophone);
    await waitFor(() => expect(hook.result.current.message).toContain("연결"));
    await act(async () => { media.enumerateDevices.mockResolvedValue(devices); window.dispatchEvent(new Event("focus")); });
    expect(hook.result.current.available).toBe(true);
  });

  it("handles browsers without recording support and device discovery failures", async () => {
    vi.stubGlobal("MediaRecorder", undefined);
    const hook = renderHook(useMicrophone);
    await waitFor(() => expect(hook.result.current.message).toContain("최신 브라우저"));
    vi.stubGlobal("MediaRecorder", class {});
    media.enumerateDevices.mockRejectedValue(new DOMException("device read failed"));
    await act(async () => { media.dispatchEvent(new Event("devicechange")); });
    expect(hook.result.current.message).toContain("확인할 수 없습니다");
    expect(hook.result.current.available).toBe(false);
  });

  it.each(["NotFoundError", "NotAllowedError", "NotReadableError", "OverconstrainedError", "NotSupportedError", "UnknownError"])("gives Korean guidance for %s without exposing the browser message", (name) => {
    const message = microphoneErrorMessage(new DOMException("Requested device not found", name));
    expect(message).toMatch(/[가-힣]/);
    expect(message).not.toContain(name);
    expect(message).not.toContain("Requested device");
  });
});
