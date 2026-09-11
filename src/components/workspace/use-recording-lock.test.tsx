import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 상세 창(`route:enrollment/abc`) 안에서 수정으로 드릴인한 상태 — 경로로 만든 id는 그 창이 아니다.
vi.mock("next/navigation", () => ({
  usePathname: () => "/enrollment/abc/edit",
  useRouter: () => ({ push: () => {} }),
}));
const { publish } = vi.hoisted(() => ({ publish: vi.fn() }));
vi.mock("@/lib/realtime/window-busy", () => ({ publishWindowBusy: publish }));

import { useRecordingLock } from "./use-recording-lock";

/**
 * 녹음 잠금 신호 — 창 id는 **부모가** 정한다(이 iframe = 그 창). 경로로 추측한 id는 드릴인에서 없는 창을
 * 가리켜([[#69]] ①), 녹음 중인 진짜 창이 닫기·창 개수 한도 축출에 노출됐다(전수검사 2026-09-11).
 */

const origParent = Object.getOwnPropertyDescriptor(window, "parent");
let parent: { postMessage: ReturnType<typeof vi.fn> };

function setParent(value: unknown) {
  Object.defineProperty(window, "parent", { configurable: true, value });
}

beforeEach(() => {
  publish.mockClear();
  parent = { postMessage: vi.fn() };
  setParent(parent); // 창(iframe) 안
});
afterEach(() => {
  if (origParent) Object.defineProperty(window, "parent", origParent);
  else delete (window as { parent?: unknown }).parent;
});

const busyCalls = () =>
  parent.postMessage.mock.calls
    .map(([msg]) => msg as { type?: string; active?: boolean })
    .filter((m) => m?.type === "eywa-window-busy");

describe("useRecordingLock — 창(iframe) 안이면 부모에게 직접 알린다", () => {
  it("🔴 녹음 시작·정지를 부모 창에 postMessage로 보낸다", () => {
    const { rerender } = renderHook(({ on }) => useRecordingLock(on), { initialProps: { on: true } });
    expect(busyCalls().at(-1)).toEqual({ type: "eywa-window-busy", active: true });

    rerender({ on: false });
    expect(busyCalls().at(-1)).toEqual({ type: "eywa-window-busy", active: false });
  });

  it("🔴 문서가 통째로 내려가면(창 ←·첫 화면으로 떠나기 확인) 잠금을 푼다 — 언마운트 정리가 안 도는 경로", () => {
    renderHook(() => useRecordingLock(true));
    parent.postMessage.mockClear();
    publish.mockClear();

    window.dispatchEvent(new Event("pagehide"));

    expect(busyCalls()).toEqual([{ type: "eywa-window-busy", active: false }]);
    expect(publish).toHaveBeenCalledWith(expect.any(String), false);
  });

  it("언마운트해도 잠금을 푼다", () => {
    const { unmount } = renderHook(() => useRecordingLock(true));
    parent.postMessage.mockClear();

    unmount();

    expect(busyCalls()).toEqual([{ type: "eywa-window-busy", active: false }]);
  });

  it("창이 아니면(전체 화면) postMessage를 보내지 않는다 — 탭 새로고침 가드용 방송은 그대로", () => {
    setParent(window);
    const post = vi.spyOn(window, "postMessage");
    renderHook(() => useRecordingLock(true));

    expect(post).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledWith(expect.any(String), true);
    post.mockRestore();
  });
});
