import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CnMatchMap } from "../classnote-match";
import { CN_LIVE_BOOST_POLL_MS, CN_LIVE_POLL_MS } from "../classnote-match-live";
import { useLiveClassnoteMatch } from "./use-live-classnote-match";

const A = "11111111-1111-4111-8111-111111111111";
const initial: CnMatchMap = { available: true, byKey: {}, okBoards: {}, eligibleClassIds: [A], version: "v1" };
const fresh: CnMatchMap = {
  available: true,
  byKey: { [`${A}|s1`]: { status: "ok", boardName: "A반", childNames: ["지호"], reasons: [] } },
  okBoards: {},
  eligibleClassIds: [A],
  version: "v2",
};

const fetchMock = vi.fn();
const reply = (body: unknown, ok = true) => Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response);

function setVisibility(value: "hidden" | "visible") {
  Object.defineProperty(document, "visibilityState", { configurable: true, value });
  document.dispatchEvent(new Event("visibilitychange"));
}

const mount = (enabled = true) =>
  renderHook(({ map }) => useLiveClassnoteMatch(map, { enabled, date: "2026-11-04", classIds: [A, A] }), {
    initialProps: { map: initial },
  });

describe("useLiveClassnoteMatch — C.N 아이콘 새로고침 없는 갱신(원장 2026-11-04)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("60초마다 지금 버전을 싣고 묻는다 — 같으면 지도를 바꾸지 않는다", async () => {
    fetchMock.mockImplementation(() => reply({ version: "v1" }));
    const { result } = mount();
    expect(fetchMock).not.toHaveBeenCalled(); // 첫 렌더는 막 받은 값이다
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CN_LIVE_POLL_MS);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain("/api/onescreen/classnote-match?");
    expect(url).toContain("known=v1");
    expect(url).toContain(`classes=${A}`);
    expect(result.current.map).toBe(initial);
  });

  it("🔴 버전이 바뀌면 지도만 갈아 끼운다(새로고침 없음)", async () => {
    fetchMock.mockImplementation(() => reply({ version: "v2", map: fresh }));
    const { result } = mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CN_LIVE_POLL_MS);
    });
    expect(result.current.map).toBe(fresh);
    // 다음 확인은 새 버전을 싣는다.
    fetchMock.mockImplementation(() => reply({ version: "v2" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CN_LIVE_POLL_MS);
    });
    expect(String(fetchMock.mock.calls[1]![0])).toContain("known=v2");
  });

  it("🔴 실패(500·네트워크)는 지난 값을 그대로 두고 다음 주기에 다시 묻는다", async () => {
    fetchMock.mockImplementationOnce(() => reply({ version: null }, false)).mockImplementationOnce(() => Promise.reject(new Error("offline")));
    const { result } = mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CN_LIVE_POLL_MS * 2);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.map).toBe(initial);
  });

  it("안 보이는 동안은 묻지 않고, 다시 보이면 바로 한 번 묻는다", async () => {
    fetchMock.mockImplementation(() => reply({ version: "v1" }));
    mount();
    setVisibility("hidden");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CN_LIVE_POLL_MS * 3);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      setVisibility("visible");
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("🔴 동기화를 요청한 직후(boost)엔 15초 주기로 본다", async () => {
    fetchMock.mockImplementation(() => reply({ version: "v1" }));
    const { result } = mount();
    act(() => result.current.boost());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CN_LIVE_BOOST_POLL_MS);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CN_LIVE_BOOST_POLL_MS);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("페이지가 새 지도를 내려 주면 그게 이긴다(앞서 갱신한 값보다)", async () => {
    fetchMock.mockImplementation(() => reply({ version: "v2", map: fresh }));
    const { result, rerender } = mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CN_LIVE_POLL_MS);
    });
    expect(result.current.map).toBe(fresh);
    const fromPage: CnMatchMap = { ...initial, version: "v3" };
    rerender({ map: fromPage });
    expect(result.current.map).toBe(fromPage);
  });

  it("ClassNote가 꺼진 학원은 묻지 않는다", async () => {
    mount(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CN_LIVE_POLL_MS * 2);
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
