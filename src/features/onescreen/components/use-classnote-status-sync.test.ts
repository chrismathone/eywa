import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useClassnoteStatusSync } from "./use-classnote-status-sync";

const { statusMock } = vi.hoisted(() => ({ statusMock: vi.fn() }));
vi.mock("../server/status-actions", () => ({ getClassnoteStatuses: statusMock }));

function setVisibility(value: "hidden" | "visible") {
  Object.defineProperty(document, "visibilityState", { configurable: true, value });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("useClassnoteStatusSync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    statusMock.mockReset();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("대기 중인 학생이 있으면 10초마다 상태를 다시 읽고 바뀐 것만 알려준다", async () => {
    statusMock.mockResolvedValue([{ studentId: "s1", subject: "math", status: "success" }]);
    const onRows = vi.fn();
    renderHook(() => useClassnoteStatusSync("2026-07-21", ["s1"], onRows));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(statusMock).toHaveBeenCalledWith("2026-07-21", ["s1"]);
    expect(onRows).toHaveBeenCalledTimes(1);

    // 다음 주기에 같은 값이 오면 화면을 건드리지 않는다.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(statusMock).toHaveBeenCalledTimes(2);
    expect(onRows).toHaveBeenCalledTimes(1);
  });

  it("대기 중인 학생이 없으면 조회하지 않는다", async () => {
    const onRows = vi.fn();
    renderHook(() => useClassnoteStatusSync("2026-07-21", [], onRows));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(statusMock).not.toHaveBeenCalled();
  });

  it("발송이 다 끝나 목록이 비면 감시를 멈춘다", async () => {
    statusMock.mockResolvedValue([{ studentId: "s1", subject: "math", status: "success" }]);
    const onRows = vi.fn();
    const { rerender } = renderHook(({ ids }) => useClassnoteStatusSync("2026-07-21", ids, onRows), {
      initialProps: { ids: ["s1"] as string[] },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    const calls = statusMock.mock.calls.length;

    rerender({ ids: [] }); // 대기 학생 없음
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(statusMock).toHaveBeenCalledTimes(calls);
  });

  it("화면이 가려진 동안은 건너뛰고, 돌아오면 즉시 한 번 읽는다", async () => {
    statusMock.mockResolvedValue([]);
    const onRows = vi.fn();
    renderHook(() => useClassnoteStatusSync("2026-07-21", ["s1"], onRows));

    act(() => setVisibility("hidden"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(statusMock).not.toHaveBeenCalled();

    await act(async () => {
      setVisibility("visible");
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(statusMock).toHaveBeenCalledTimes(1);
  });

  it("가려 둔 시간은 '무변화' 시간으로 세지 않는다 — 돌아오면 멈추지 말고 확인한다", async () => {
    statusMock.mockResolvedValue([]);
    const onRows = vi.fn();
    renderHook(() => useClassnoteStatusSync("2026-07-21", ["s1"], onRows));

    act(() => setVisibility("hidden"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20 * 60_000); // 20분간 안 봄
    });
    await act(async () => {
      setVisibility("visible");
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(statusMock).toHaveBeenCalledTimes(1);
  });

  it("조회가 실패해도 조용히 다음 주기에 다시 시도한다(배지는 직전 값 유지)", async () => {
    statusMock.mockRejectedValueOnce(new Error("network")).mockResolvedValue([
      { studentId: "s1", subject: "math", status: "success" },
    ]);
    const onRows = vi.fn();
    renderHook(() => useClassnoteStatusSync("2026-07-21", ["s1"], onRows));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(onRows).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(onRows).toHaveBeenCalledTimes(1);
  });
});
