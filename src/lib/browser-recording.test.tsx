import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ save: vi.fn(), download: vi.fn(), initialize: vi.fn() }));
vi.mock("@/lib/recording-recovery", async (original) => ({
  ...await original<typeof import("@/lib/recording-recovery")>(),
  saveChunk: (...args: unknown[]) => mocks.save(...args),
  startRecoverySession: (...args: unknown[]) => mocks.initialize(...args),
}));
vi.mock("@/lib/audio-upload", async (original) => ({ ...await original<typeof import("@/lib/audio-upload")>(), downloadFile: (...args: unknown[]) => mocks.download(...args) }));
const router = { push: vi.fn() };
vi.mock("next/navigation", () => ({ usePathname: () => "/meetings/new", useRouter: () => router }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("@/lib/realtime/window-busy", () => ({ publishWindowBusy: vi.fn() }));

import { adoptRecordingOwner, dismissBrowserRecording, getBrowserRecording, recordingMatches, startBrowserRecording, stopBrowserRecording } from "./browser-recording";
import { useBrowserRecording } from "@/components/forms/use-browser-recording";
import { RecordingOwnerGuard, RecordingRuntime } from "@/components/forms/recording-runtime";

const scopeA = { tenantId: "t1", userId: "u1", recordKey: "enrollment:a", label: "A" };
const scopeB = { ...scopeA, recordKey: "enrollment:b", label: "B" };
class Track extends EventTarget {
  stop = vi.fn();
}
class FakeRecorder {
  static instances: FakeRecorder[] = [];
  static supported = "audio/webm;codecs=opus";
  static isTypeSupported(mime: string) { return mime === this.supported; }
  state = "inactive";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((event: { error: DOMException }) => void) | null = null;
  stopCount = 0;
  constructor() { FakeRecorder.instances.push(this); }
  start() { this.state = "recording"; }
  chunk(value: string) { this.ondataavailable?.({ data: new Blob([value], { type: "audio/webm" }) }); }
  stop() { this.stopCount++; this.state = "inactive"; this.chunk("final"); this.onstop?.(); }
}
let track: Track;
let getMedia: ReturnType<typeof vi.fn>;
let denyLock = false;
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  adoptRecordingOwner({ tenantId: "reset", userId: crypto.randomUUID() });
  adoptRecordingOwner(scopeA);
  FakeRecorder.instances = [];
  FakeRecorder.supported = "audio/webm;codecs=opus";
  track = new Track();
  getMedia = vi.fn(async () => ({ getTracks: () => [track] }));
  denyLock = false;
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: getMedia } });
  Object.defineProperty(navigator, "locks", { configurable: true, value: {
    request: (_key: string, _options: unknown, callback: (lock: object | null) => Promise<void>) => callback(denyLock ? null : {}),
    query: async () => ({ held: [] }),
  } });
  mocks.initialize.mockImplementation(async (kind, mimeType, scope) => ({ id: crypto.randomUUID(), kind, mimeType, fileName: `${scope.label}.${mimeType === "audio/mp4" ? "m4a" : "webm"}` }));
});
afterEach(() => {
  act(() => { stopBrowserRecording(); dismissBrowserRecording(); });
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function start() { await act(async () => { await startBrowserRecording("consultation", scopeA); }); }
const recorder = () => FakeRecorder.instances[0];

describe("document-owned audio recording", () => {
  it("keeps recording after the originating form unmounts and exposes the icon on another page", async () => {
    const completedA = vi.fn();
    const source = renderHook(() => useBrowserRecording("consultation", scopeA, completedA));
    render(<RecordingRuntime />);
    await start();
    source.unmount();
    act(() => { vi.advanceTimersByTime(3000); });
    expect(recorder().state).toBe("recording");
    expect(track.stop).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /녹음 중 · 00:03/ }));
    expect(screen.getByRole("region", { name: "녹음 진행" })).toHaveTextContent("A");
    const beforeUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(beforeUnload);
    expect(beforeUnload.defaultPrevented).toBe(true);
    act(() => { fireEvent.click(screen.getByRole("button", { name: "녹음 중지" })); });
    expect(mocks.download).toHaveBeenCalledTimes(1);
    expect(mocks.save).toHaveBeenCalledWith(expect.any(String), 0, expect.any(Blob));
    expect(getBrowserRecording()?.file?.name).toBe("A.webm");
    const resumed = vi.fn();
    renderHook(() => useBrowserRecording("consultation", scopeA, resumed));
    expect(resumed).toHaveBeenCalledWith(expect.any(File), getBrowserRecording()?.meta?.id);
    expect(completedA).not.toHaveBeenCalled();
  });

  it("never gives A's file to B and blocks B from replacing the active session", async () => {
    const toB = vi.fn();
    const destination = renderHook(() => useBrowserRecording("consultation", scopeB, toB));
    await start();
    const id = getBrowserRecording()?.requestId;
    expect(destination.result.current.otherRecording).toBe(true);
    expect(destination.result.current.recording).toBe(false);
    let error: string | null = null;
    await act(async () => { error = await startBrowserRecording("meeting", { ...scopeB, label: "B 회의" }); });
    expect(error).toContain("이미 녹음 중");
    expect(getBrowserRecording()?.requestId).toBe(id);
    expect(FakeRecorder.instances).toHaveLength(1);
    act(() => { stopBrowserRecording(); });
    expect(toB).not.toHaveBeenCalled();
    expect(getBrowserRecording()?.scope).toEqual(scopeA);
  });

  it("captures an immutable owner and record before microphone permission completes", async () => {
    let allow!: (value: { getTracks: () => Track[] }) => void;
    getMedia.mockImplementation(() => new Promise((resolve) => { allow = resolve; }));
    const selected = { ...scopeA };
    let pending!: Promise<string | null>;
    await act(async () => { pending = startBrowserRecording("consultation", selected); await Promise.resolve(); });
    selected.recordKey = scopeB.recordKey; selected.label = "B";
    await act(async () => { allow({ getTracks: () => [track] }); await pending; });
    expect(mocks.initialize).toHaveBeenCalledWith("consultation", expect.any(String), scopeA);
    expect(recordingMatches(getBrowserRecording(), "consultation", scopeB)).toBe(false);
  });

  it("rejects a simultaneous recorder in another frame/tab before touching its microphone", async () => {
    denyLock = true;
    await start();
    expect(getMedia).not.toHaveBeenCalled();
    expect(getBrowserRecording()?.error).toContain("다른 화면에서 녹음 중");
  });

  it("cancels pending microphone permission and closes a late stream without a recording", async () => {
    let allow!: (value: { getTracks: () => Track[] }) => void;
    getMedia.mockImplementation(() => new Promise((resolve) => { allow = resolve; }));
    let pending!: Promise<string | null>;
    await act(async () => { pending = startBrowserRecording("consultation", scopeA); await Promise.resolve(); });
    act(() => { stopBrowserRecording(); });
    await act(async () => { allow({ getTracks: () => [track] }); await pending; });
    expect(track.stop).toHaveBeenCalled();
    expect(FakeRecorder.instances).toHaveLength(0);
    expect(getBrowserRecording()).toBeNull();
  });

  it("keeps partial audio and clears the timer after unexpected stop", async () => {
    await start();
    recorder().chunk("before");
    act(() => { vi.advanceTimersByTime(2000); recorder().stop(); });
    const ended = getBrowserRecording();
    expect(ended?.status).toBe("ready");
    expect(ended?.error).toContain("예기치 않게");
    expect(ended?.file?.size).toBe(11);
    act(() => { vi.advanceTimersByTime(10000); });
    expect(getBrowserRecording()?.seconds).toBe(2);
  });

  it("keeps partial audio and names the cause when the microphone disconnects", async () => {
    await start();
    act(() => { recorder().chunk("before"); track.dispatchEvent(new Event("ended")); });
    expect(getBrowserRecording()?.error).toContain("마이크 연결이 끊겨");
    expect(getBrowserRecording()?.file).toBeInstanceOf(File);
    expect(track.stop).toHaveBeenCalled();
  });

  it("preserves the recorder's error code with the final audio", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await start();
    act(() => { recorder().onerror?.({ error: new DOMException("device", "UnknownError") }); recorder().stop(); });
    expect(getBrowserRecording()?.error).toContain("UnknownError");
    expect(getBrowserRecording()?.status).toBe("ready");
    expect(mocks.download).toHaveBeenCalled();
  });

  it("shows microphone permission errors and releases the reservation", async () => {
    getMedia.mockRejectedValue(new DOMException("Permission denied", "NotAllowedError"));
    await start();
    expect(getBrowserRecording()?.status).toBe("failed");
    expect(getBrowserRecording()?.error).toContain("NotAllowedError");
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it("stops and detaches the old account on identity change, preserving its local backup", async () => {
    await start();
    act(() => { recorder().chunk("before"); adoptRecordingOwner({ tenantId: "t2", userId: "u2" }); });
    expect(recorder().state).toBe("inactive");
    expect(track.stop).toHaveBeenCalled();
    expect(getBrowserRecording()).toBeNull();
    expect(mocks.save).toHaveBeenCalled();
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it("uses m4a for mp4 recording instead of labelling Safari audio as webm", async () => {
    FakeRecorder.supported = "audio/mp4";
    await start();
    act(() => { stopBrowserRecording(); });
    expect(getBrowserRecording()?.file?.name).toBe("A.m4a");
    expect(getBrowserRecording()?.file?.type).toBe("audio/mp4");
  });
  it("retires the microphone and keeps chunks when a soft logout removes the authenticated shell", async () => {
    const authenticated = render(<RecordingOwnerGuard owner={scopeA} />);
    await start();
    authenticated.unmount();
    expect(recorder().state).toBe("inactive");
    expect(getBrowserRecording()).toBeNull();
    expect(mocks.save).toHaveBeenCalled();
    expect(mocks.download).not.toHaveBeenCalled();
  });
});
