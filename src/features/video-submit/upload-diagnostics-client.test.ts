import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createUploadReporter, flushUploadEvents } from "./upload-diagnostics-client";

let serial = 0;
let reporter: ReturnType<typeof createUploadReporter> | undefined;
beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); serial++; vi.spyOn(navigator, "sendBeacon").mockReturnValue(true); });
afterEach(() => { reporter?.dispose(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("중단 기록 전송과 복구", () => {
  it("인터넷이 끊기면 보관하고 다시 연결되면 같은 사건을 전송한다", async () => {
    const token = `retry-${serial}`;
    const fetcher = vi.fn().mockRejectedValue(new Error("offline")); vi.stubGlobal("fetch", fetcher);
    reporter = createUploadReporter(token, "upload", 100, vi.fn()); reporter.progress(40); reporter.event("failed", { reason: "network" });
    await flushUploadEvents(token);
    expect(localStorage.getItem(`aywa.videoSubmit.diagnostics.${token}`)).toContain('"sentBytes":40');
    fetcher.mockResolvedValue(new Response(null, { status: 204 })); await flushUploadEvents(token);
    expect(localStorage.getItem(`aywa.videoSubmit.diagnostics.${token}`)).toBeNull();
    expect(fetcher.mock.calls.map(c => JSON.parse(c[1].body).event.kind)).toContain("failed");
  });
  it("로컬 저장소 용량 초과에도 메모리 큐로 기록하고 콜백 오류는 업로드를 깨지 않는다", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 })); vi.stubGlobal("fetch", fetcher);
    const token = `memory-${serial}`;
    expect(() => { reporter = createUploadReporter(token, "upload", 100, () => { throw new Error("render"); }); }).not.toThrow();
    await flushUploadEvents(token); expect(fetcher).toHaveBeenCalled();
  });
  it("진행이 없는 상태·화면 이동을 구별하고 종료 뒤 타이머가 남지 않는다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    const observer = vi.fn(); reporter = createUploadReporter(`idle-${serial}`, "upload", 100, observer);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(observer).toHaveBeenCalledWith(expect.objectContaining({ kind: "stalled", reason: "no_progress" }));
    window.dispatchEvent(new Event("pagehide"));
    expect(observer).toHaveBeenCalledWith(expect.objectContaining({ kind: "page_left", reason: null }));
    reporter.dispose(); const count = observer.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000); window.dispatchEvent(new Event("offline")); expect(observer).toHaveBeenCalledTimes(count);
  });
});
