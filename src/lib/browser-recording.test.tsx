import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  save: vi.fn(), download: vi.fn(), initialize: vi.fn(),
  channel: null as null | {
    activation: (value: { requestId: string; owner: { tenantId: string; userId: string }; at: number }) => void;
    release: (value: { requestId: string; owner: { tenantId: string; userId: string } }) => void;
    legacy: (value: { requestId: string; owner: { tenantId: string; userId: string } }) => void;
    change: () => void;
  },
  announced: [] as { requestId: string; owner: { tenantId: string; userId: string }; at: number }[],
  released: [] as { requestId: string; owner: { tenantId: string; userId: string } }[],
}));
vi.mock("@/lib/recording-recovery", async (original) => ({
  ...await original<typeof import("@/lib/recording-recovery")>(),
  saveChunk: (...args: unknown[]) => mocks.save(...args),
  startRecoverySession: (...args: unknown[]) => mocks.initialize(...args),
}));
// 문서 사이 신호는 붙잡아 둔다 — 다른 창·탭이 보낸 '이 녹음을 시작했다'를 직접 흘려 넣는다.
vi.mock("@/lib/browser-recording-channel", async (original) => ({
  ...await original<typeof import("@/lib/browser-recording-channel")>(),
  connectRecordingChannel: (handlers: NonNullable<typeof mocks.channel>) => { mocks.channel = handlers; },
  announceActivation: (value: (typeof mocks.announced)[number]) => { mocks.announced.push(value); },
  announceRelease: (value: (typeof mocks.released)[number]) => { mocks.released.push(value); },
  announceState: () => {},
}));
vi.mock("@/lib/audio-upload", async (original) => ({ ...await original<typeof import("@/lib/audio-upload")>(), downloadFile: (...args: unknown[]) => mocks.download(...args) }));
const router = { push: vi.fn() };
vi.mock("next/navigation", () => ({ usePathname: () => "/meetings/new", useRouter: () => router }));
vi.mock("@/lib/realtime/window-busy", () => ({ publishWindowBusy: vi.fn() }));

import { adoptRecordingOwner, dismissBrowserRecording, getBrowserRecordings, pauseBrowserRecording, recordingMatches, resumeBrowserRecording, startBrowserRecording, stopBrowserRecording } from "./browser-recording";
import { useBrowserRecording } from "@/components/forms/use-browser-recording";
import { RecordingOwnerGuard, RecordingRuntime } from "@/components/forms/recording-runtime";

const scopeA = { tenantId: "t1", userId: "u1", recordKey: "enrollment:a", label: "A" };
const scopeB = { ...scopeA, recordKey: "enrollment:b", label: "B" };
const scopeC = { ...scopeA, recordKey: "enrollment:c", label: "C" };
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
  pause() { if (this.state === "recording") this.state = "paused"; }
  resume() { if (this.state === "paused") this.state = "recording"; }
  chunk(value: string) { this.ondataavailable?.({ data: new Blob([value], { type: "audio/webm" }) }); }
  stop() { this.stopCount++; this.state = "inactive"; this.chunk("final"); this.onstop?.(); }
}
let track: Track;
let getMedia: ReturnType<typeof vi.fn>;
let denyLock = false;
let lockNames: string[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.announced = [];
  mocks.released = [];
  adoptRecordingOwner({ tenantId: "reset", userId: crypto.randomUUID() });
  adoptRecordingOwner(scopeA);
  FakeRecorder.instances = [];
  FakeRecorder.supported = "audio/webm;codecs=opus";
  track = new Track();
  getMedia = vi.fn(async () => ({ getTracks: () => [track] }));
  denyLock = false;
  lockNames = [];
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: getMedia, enumerateDevices: async () => [{ kind: "audioinput" }] } });
  Object.defineProperty(navigator, "locks", { configurable: true, value: {
    request: (key: string, _options: unknown, callback: (lock: object | null) => Promise<void>) => { lockNames.push(key); return callback(denyLock ? null : {}); },
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
async function start(scope = scopeA, kind: "consultation" | "meeting" = "consultation") {
  let message: string | null = null;
  await act(async () => { message = await startBrowserRecording(kind, scope); });
  return message;
}
const recorder = (index = 0) => FakeRecorder.instances[index];
const latest = () => getBrowserRecordings().at(-1) ?? null;
const of = (scope: typeof scopeA) => getBrowserRecordings().find((value) => recordingMatches(value, "consultation", scope)) ?? null;

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
    act(() => { fireEvent.click(screen.getByRole("button", { name: "녹음 끝내기" })); });
    expect(mocks.download).toHaveBeenCalledTimes(1);
    expect(mocks.save).toHaveBeenCalledWith(expect.any(String), 0, expect.any(Blob));
    expect(latest()?.file?.name).toBe("A.webm");
    const resumed = vi.fn();
    renderHook(() => useBrowserRecording("consultation", scopeA, resumed));
    expect(resumed).toHaveBeenCalledWith(expect.any(File), latest()?.meta?.id);
    expect(completedA).not.toHaveBeenCalled();
  });

  it("captures an immutable owner and record before microphone permission completes", async () => {
    let allow!: (value: { getTracks: () => Track[] }) => void;
    getMedia.mockImplementation(() => new Promise((resolve) => { allow = resolve; }));
    const selected = { ...scopeA };
    let pending!: Promise<string | null>;
    await act(async () => { pending = startBrowserRecording("consultation", selected); for (let i = 0; i < 12; i++) await Promise.resolve(); });
    selected.recordKey = scopeB.recordKey; selected.label = "B";
    await act(async () => { allow({ getTracks: () => [track] }); await pending; });
    expect(mocks.initialize).toHaveBeenCalledWith("consultation", expect.any(String), scopeA);
    expect(recordingMatches(latest(), "consultation", scopeB)).toBe(false);
  });

  it("cancels pending microphone permission and closes a late stream without a recording", async () => {
    let allow!: (value: { getTracks: () => Track[] }) => void;
    getMedia.mockImplementation(() => new Promise((resolve) => { allow = resolve; }));
    let pending!: Promise<string | null>;
    await act(async () => { pending = startBrowserRecording("consultation", scopeA); for (let i = 0; i < 12; i++) await Promise.resolve(); });
    act(() => { stopBrowserRecording(); });
    await act(async () => { allow({ getTracks: () => [track] }); await pending; });
    expect(track.stop).toHaveBeenCalled();
    expect(FakeRecorder.instances).toHaveLength(0);
    expect(latest()).toBeNull();
  });

  it("keeps partial audio and clears the timer after unexpected stop", async () => {
    await start();
    recorder().chunk("before");
    act(() => { vi.advanceTimersByTime(2000); recorder().stop(); });
    const ended = latest();
    expect(ended?.status).toBe("ready");
    expect(ended?.error).toContain("예기치 않게");
    expect(ended?.file?.size).toBe(11);
    act(() => { vi.advanceTimersByTime(10000); });
    expect(latest()?.seconds).toBe(2);
  });

  it("keeps partial audio and names the cause when the microphone disconnects", async () => {
    await start();
    act(() => { recorder().chunk("before"); track.dispatchEvent(new Event("ended")); });
    expect(latest()?.error).toContain("마이크 연결이 끊겨");
    expect(latest()?.file).toBeInstanceOf(File);
    expect(track.stop).toHaveBeenCalled();
  });

  it("preserves the recorder's error code with the final audio", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await start();
    act(() => { recorder().onerror?.({ error: new DOMException("device", "UnknownError") }); recorder().stop(); });
    expect(latest()?.errorCode).toBe("UnknownError");
    expect(latest()?.error).toContain("녹음 오류");
    expect(latest()?.error).not.toContain("UnknownError");
    expect(latest()?.status).toBe("ready");
    expect(mocks.download).toHaveBeenCalled();
  });

  it("shows microphone permission errors and releases the reservation", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    getMedia.mockRejectedValue(new DOMException("Permission denied", "NotAllowedError"));
    await start();
    expect(latest()?.status).toBe("failed");
    expect(latest()?.errorCode).toBe("NotAllowedError");
    expect(latest()?.error).toContain("마이크 권한");
    expect(latest()?.error).not.toContain("Permission denied");
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it("stops and detaches the old account on identity change, preserving its local backup", async () => {
    await start();
    act(() => { recorder().chunk("before"); adoptRecordingOwner({ tenantId: "t2", userId: "u2" }); });
    expect(recorder().state).toBe("inactive");
    expect(track.stop).toHaveBeenCalled();
    expect(latest()).toBeNull();
    expect(mocks.save).toHaveBeenCalled();
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it("uses m4a for mp4 recording instead of labelling Safari audio as webm", async () => {
    FakeRecorder.supported = "audio/mp4";
    await start();
    act(() => { stopBrowserRecording(); });
    expect(latest()?.file?.name).toBe("A.m4a");
    expect(latest()?.file?.type).toBe("audio/mp4");
  });

  it("retires the microphone and keeps chunks when a soft logout removes the authenticated shell", async () => {
    const authenticated = render(<RecordingOwnerGuard owner={scopeA} />);
    await start();
    authenticated.unmount();
    expect(recorder().state).toBe("inactive");
    expect(latest()).toBeNull();
    expect(mocks.save).toHaveBeenCalled();
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it("does not open a microphone, create a recording or show controls when no mic is recognized", async () => {
    vi.spyOn(navigator.mediaDevices, "enumerateDevices").mockResolvedValue([]);
    expect(await startBrowserRecording("meeting", scopeA)).toContain("마이크를 연결");
    expect(getMedia).not.toHaveBeenCalled();
    expect(latest()).toBeNull();
    expect(mocks.initialize).not.toHaveBeenCalled();
  });

  it("freezes attribution before device discovery and rejects an owner change while it is pending", async () => {
    let finishProbe!: (devices: MediaDeviceInfo[]) => void;
    vi.spyOn(navigator.mediaDevices, "enumerateDevices").mockImplementation(() => new Promise((resolve) => { finishProbe = resolve; }));
    const selected = { ...scopeA };
    const pending = startBrowserRecording("meeting", selected);
    for (let i = 0; i < 12; i++) await Promise.resolve();
    selected.label = "B";
    adoptRecordingOwner({ tenantId: "t2", userId: "u2" });
    finishProbe([{ kind: "audioinput" } as MediaDeviceInfo]);
    expect(await pending).toContain("작성 화면을 다시");
    expect(getMedia).not.toHaveBeenCalled();
    expect(latest()).toBeNull();
  });
});

/** 원장 2026-10-16 — 여러 개를 켜 두되 소리를 담는 것은 하나, 나머지는 자동 일시정지. 같은 대상은 하나. */
describe("여러 녹음 — 누른 녹음만 녹음", () => {
  it("B를 시작하면 A는 일시정지되고, 파일은 각자의 작성 화면으로만 간다", async () => {
    const toA = vi.fn();
    const toB = vi.fn();
    renderHook(() => useBrowserRecording("consultation", scopeA, toA));
    const formB = renderHook(() => useBrowserRecording("consultation", scopeB, toB));
    await start(scopeA);
    expect(formB.result.current.othersRecording).toBe(true);
    expect(formB.result.current.recording).toBe(false);
    expect(await start(scopeB)).toBeNull();
    expect(FakeRecorder.instances).toHaveLength(2);
    expect(recorder(0).state).toBe("paused");
    expect(recorder(1).state).toBe("recording");
    expect(of(scopeA)?.status).toBe("paused");
    expect(of(scopeB)?.status).toBe("recording");
    act(() => { stopBrowserRecording(of(scopeB)!.requestId); });
    expect(toB).toHaveBeenCalledWith(expect.objectContaining({ name: "B.webm" }), expect.any(String));
    expect(toA).not.toHaveBeenCalled();
    expect(of(scopeA)?.status).toBe("paused");
    act(() => { stopBrowserRecording(of(scopeA)!.requestId); });
    expect(toA).toHaveBeenCalledWith(expect.objectContaining({ name: "A.webm" }), expect.any(String));
  });

  it("이어서 녹음을 누르면 그 녹음만 소리를 담고 나머지는 일시정지된다 — 시간은 담은 시간만 센다", async () => {
    await start(scopeA);
    act(() => { vi.advanceTimersByTime(3000); });
    await start(scopeB);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(of(scopeA)?.seconds).toBe(3);
    expect(of(scopeB)?.seconds).toBe(5);
    act(() => { resumeBrowserRecording(of(scopeA)!.requestId); });
    expect(recorder(0).state).toBe("recording");
    expect(recorder(1).state).toBe("paused");
    act(() => { vi.advanceTimersByTime(2000); });
    expect(of(scopeA)?.seconds).toBe(5);
    expect(of(scopeB)?.seconds).toBe(5);
    act(() => { pauseBrowserRecording(of(scopeA)!.requestId); vi.advanceTimersByTime(4000); });
    expect(of(scopeA)?.status).toBe("paused");
    expect(of(scopeA)?.seconds).toBe(5);
    act(() => { stopBrowserRecording(of(scopeA)!.requestId); });
    expect(of(scopeA)?.status).toBe("ready");
    expect(of(scopeA)?.seconds).toBe(5);
  });

  it("세 개를 켜도 소리를 담는 것은 늘 하나다", async () => {
    await start(scopeA);
    await start(scopeB);
    await start(scopeC);
    const capturing = () => FakeRecorder.instances.filter((item) => item.state === "recording");
    expect(capturing()).toEqual([recorder(2)]);
    act(() => { resumeBrowserRecording(of(scopeB)!.requestId); });
    expect(capturing()).toEqual([recorder(1)]);
    expect(getBrowserRecordings().filter((value) => value.status === "recording").map((value) => value.scope.label)).toEqual(["B"]);
  });

  it("같은 대상은 한 번만 — 두 번째 시작은 마이크를 열지 않는다", async () => {
    await start(scopeA);
    expect(await start(scopeA)).toContain("이미 녹음하고");
    expect(getMedia).toHaveBeenCalledTimes(1);
    expect(FakeRecorder.instances).toHaveLength(1);
    expect(recorder().state).toBe("recording");
  });

  it("다른 창·탭이 같은 대상을 녹음 중이면(대상 잠금) 마이크를 열지 않는다 · 잠금은 대상마다 따로", async () => {
    await start(scopeA);
    denyLock = true;
    await start(scopeB);
    expect(getMedia).toHaveBeenCalledTimes(1);
    expect(of(scopeB)?.status).toBe("failed");
    expect(of(scopeB)?.error).toContain("다른 창이나 탭에서 같은 녹음");
    // 실패한 시작은 진행 중인 녹음을 멈추지 않는다.
    expect(recorder().state).toBe("recording");
    expect(new Set(lockNames).size).toBe(2);
    expect(lockNames[0]).toContain("enrollment:a");
  });

  it("다른 창·탭에서 나중에 누른 녹음이 있으면 이 문서의 녹음은 일시정지된다 · 먼저 누른 것이면 그대로", async () => {
    await start(scopeA);
    const mine = mocks.announced.at(-1)!;
    expect(mine.owner).toEqual({ tenantId: "t1", userId: "u1" });
    act(() => { mocks.channel?.activation({ requestId: "other", owner: mine.owner, at: mine.at - 1 }); });
    expect(recorder().state).toBe("recording");
    act(() => { mocks.channel?.activation({ requestId: "other", owner: { tenantId: "t1", userId: "someone" }, at: mine.at + 10 }); });
    expect(recorder().state).toBe("recording");
    act(() => { mocks.channel?.activation({ requestId: "other", owner: mine.owner, at: mine.at + 10 }); });
    expect(recorder().state).toBe("paused");
    expect(of(scopeA)?.status).toBe("paused");
  });

  it("마이크 권한을 기다리는 동안 다른 녹음이 눌리면, 준비가 끝나자마자 일시정지로 둔다", async () => {
    let allow!: (value: { getTracks: () => Track[] }) => void;
    getMedia.mockImplementation(() => new Promise((resolve) => { allow = resolve; }));
    let pending!: Promise<string | null>;
    await act(async () => { pending = startBrowserRecording("consultation", scopeA); for (let i = 0; i < 12; i++) await Promise.resolve(); });
    act(() => { mocks.channel?.activation({ requestId: "other", owner: { tenantId: "t1", userId: "u1" }, at: Date.now() + 5 }); });
    await act(async () => { allow({ getTracks: () => [track] }); await pending; });
    expect(recorder().state).toBe("paused");
    expect(of(scopeA)?.status).toBe("paused");
  });

  it("🔴 B가 시작하지 못하면(마이크 거부) B 때문에 멈춘 A가 다시 녹음한다 — 녹음하던 상담이 조용히 멈춘 채 남지 않게", async () => {
    await start(scopeA);
    getMedia.mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));
    await start(scopeB);
    expect(of(scopeB)?.status).toBe("failed");
    expect(recorder(0).state).toBe("recording");
    expect(of(scopeA)?.status).toBe("recording");
  });

  it("🔴 B를 준비 중에 끝내도 A가 다시 녹음한다 · 늦게 열린 마이크는 녹음이 되지 않는다", async () => {
    await start(scopeA);
    let allow!: (value: { getTracks: () => Track[] }) => void;
    getMedia.mockImplementation(() => new Promise((resolve) => { allow = resolve; }));
    let pending!: Promise<string | null>;
    await act(async () => { pending = startBrowserRecording("consultation", scopeB); for (let i = 0; i < 12; i++) await Promise.resolve(); });
    expect(recorder(0).state).toBe("paused");
    act(() => { stopBrowserRecording(of(scopeB)!.requestId); });
    expect(recorder(0).state).toBe("recording");
    await act(async () => { allow({ getTracks: () => [track] }); await pending; });
    expect(FakeRecorder.instances).toHaveLength(1);
    expect(of(scopeA)?.status).toBe("recording");
  });

  it("🔴 A 녹음 중 B(준비 중) → C를 누른 뒤 B가 실패해도 마지막에 누른 C가 녹음한다 — A가 되살아나 C를 멈추지 않는다", async () => {
    await start(scopeA);
    let failB!: (error: unknown) => void;
    getMedia.mockImplementationOnce(() => new Promise((_, reject) => { failB = reject; }));
    let pendingB!: Promise<string | null>;
    await act(async () => { pendingB = startBrowserRecording("consultation", scopeB); for (let i = 0; i < 12; i++) await Promise.resolve(); });
    await start(scopeC);
    expect(recorder(1).state).toBe("recording");
    await act(async () => { failB(new DOMException("denied", "NotAllowedError")); await pendingB; });
    expect(of(scopeB)?.status).toBe("failed");
    expect(recorder(0).state).toBe("paused");
    expect(recorder(1).state).toBe("recording");
    expect(of(scopeC)?.status).toBe("recording");
  });

  it("🔴 준비 중인 녹음의 문서가 내려가면 다른 창·탭에 알린다 — 그 녹음 탓에 멈춘 녹음이 멈춘 채 남지 않게", async () => {
    getMedia.mockImplementationOnce(() => new Promise(() => {}));
    await act(async () => { void startBrowserRecording("consultation", scopeB); for (let i = 0; i < 12; i++) await Promise.resolve(); });
    const id = of(scopeB)!.requestId;
    act(() => { stopBrowserRecording(); });
    expect(mocks.released).toEqual([{ requestId: id, owner: { tenantId: "t1", userId: "u1" } }]);
  });

  it("직접 멈춰 둔 녹음은 다른 녹음의 시작이 실패해도 멈춘 그대로", async () => {
    await start(scopeA);
    act(() => { pauseBrowserRecording(of(scopeA)!.requestId); });
    getMedia.mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));
    await start(scopeB);
    expect(recorder(0).state).toBe("paused");
    expect(of(scopeA)?.status).toBe("paused");
  });

  it("다른 창·탭의 시작이 실패했다는 알림을 받으면 그 녹음 때문에 멈춘 이 문서의 녹음이 다시 녹음한다", async () => {
    await start(scopeA);
    const mine = mocks.announced.at(-1)!;
    act(() => { mocks.channel?.activation({ requestId: "other", owner: mine.owner, at: mine.at + 10 }); });
    expect(recorder().state).toBe("paused");
    act(() => { mocks.channel?.release({ requestId: "someone-else", owner: mine.owner }); });
    expect(recorder().state).toBe("paused");
    act(() => { mocks.channel?.release({ requestId: "other", owner: mine.owner }); });
    expect(recorder().state).toBe("recording");
  });

  it("새로고침하지 않은 옛 탭이 녹음을 시작하면 이 문서의 녹음은 일시정지된다(옛 탭은 일시정지 알림을 모른다)", async () => {
    await start(scopeA);
    act(() => { mocks.channel?.legacy({ requestId: "old", owner: { tenantId: "t1", userId: "u1" } }); });
    expect(recorder().state).toBe("paused");
  });

  it("두 대상의 시작이 겹쳐도 둘 다 켜지고 나중 것만 소리를 담는다", async () => {
    await act(async () => { await Promise.all([startBrowserRecording("meeting", scopeA), startBrowserRecording("consultation", scopeB)]); });
    expect(FakeRecorder.instances).toHaveLength(2);
    expect(FakeRecorder.instances.filter((item) => item.state === "recording")).toHaveLength(1);
  });

  it("녹음마다 아이콘 하나 — 제목이 붙고, 녹음 중·일시정지가 구분된다", async () => {
    render(<RecordingRuntime />);
    await start(scopeA);
    await start(scopeB);
    const a = screen.getByRole("button", { name: /^A · 일시정지 · / });
    const b = screen.getByRole("button", { name: /^B · 녹음 중 · / });
    expect(a.parentElement?.dataset.state).toBe("paused");
    expect(b.parentElement?.dataset.state).toBe("recording");
    expect(a.textContent).toContain("A");
    // 아이콘끼리 겹치지 않게 다른 자리에서 시작한다.
    expect(a.parentElement?.style.top).not.toBe(b.parentElement?.style.top);
    fireEvent.click(a, { detail: 1 });
    act(() => { fireEvent.click(screen.getByRole("button", { name: "이어서 녹음" })); });
    expect(of(scopeA)?.status).toBe("recording");
    expect(of(scopeB)?.status).toBe("paused");
  });

  it("작성 폼이 화면에 붙어 있으면 '작성 화면 열기'는 주소를 옮기지 않는다 · 떨어져 있으면 돌아갈 곳으로", async () => {
    render(<RecordingRuntime />);
    await act(async () => { await startBrowserRecording("consultation", scopeA, { href: "/enrollment/new?form=x" }); });
    const form = renderHook(() => useBrowserRecording("consultation", scopeA, vi.fn()));
    fireEvent.click(screen.getByRole("button", { name: /^A · 녹음 중 · / }), { detail: 1 });
    fireEvent.click(screen.getByRole("button", { name: "작성 화면 열기" }));
    expect(router.push).not.toHaveBeenCalled();
    form.unmount();
    fireEvent.click(screen.getByRole("button", { name: /^A · 녹음 중 · / }), { detail: 1 });
    fireEvent.click(screen.getByRole("button", { name: "작성 화면 열기" }));
    expect(router.push).toHaveBeenCalledWith("/enrollment/new?form=x");
  });
});
