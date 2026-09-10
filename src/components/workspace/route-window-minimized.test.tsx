import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

import { RouteWindow } from "./route-window";
import { useWindowStore, windowId, type Win } from "./window-store";

/**
 * 최소화된 창은 `display:none`(floating-window.tsx)이라 문서를 로드해도 **레이아웃이 0**이다 —
 * 셸·인증·DB 쿼리는 전부 치르면서 글리프는 한 자도 안 그린다. 2026-09-10 실측으로 그 대가가 드러났다:
 * 최소화 창 문서는 2MB Pretendard preload를 **받고도** FontFace가 `unloaded`로 남아, 크롬이 창 수만큼
 * "preloaded but not used" 경고를 찍었다(원장 제보: "주기적으로 계속 쌓이네").
 *
 * 그래서 최소화 창은 **복원될 때** 로드한다. 이 파일은 그 규약이 되돌아가지 않게 잠근다.
 */

const HREF = "/timetable";
const ID = windowId("route", "timetable");

function makeWin(overrides: Partial<Win> = {}): Win {
  return {
    id: ID,
    kind: "route",
    params: { id: "timetable", title: "시간표", href: HREF },
    rect: { x: 0, y: 0, w: 800, h: 600 },
    minimized: false,
    maximized: false,
    ...overrides,
  } as Win;
}

function srcOf(container: HTMLElement) {
  return container.querySelector("iframe")?.getAttribute("src") ?? null;
}

beforeEach(() => {
  vi.useFakeTimers();
  useWindowStore.setState({ windows: {}, order: [ID], focusedId: null, cached: [], reloadNonce: {} });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("RouteWindow — 최소화된 창은 문서를 로드하지 않는다", () => {
  it("🔴 최소화 상태로 복원된 창은 stagger가 다 지나도 iframe src가 안 붙는다", () => {
    const { container } = render(<RouteWindow win={makeWin({ minimized: true })} />);
    act(() => {
      vi.advanceTimersByTime(10_000); // stagger(250 + index*250)를 한참 넘겨도
    });
    expect(srcOf(container)).toBeNull();
  });

  it("보이는 창은 종전대로 로드한다(포커스면 즉시)", () => {
    useWindowStore.setState({ focusedId: ID });
    const { container } = render(<RouteWindow win={makeWin()} />);
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(srcOf(container)).toBe("/timetable?embed=1");
  });

  it("🔴 최소화 창도 **복원되면** 그때 로드한다(영영 빈 창으로 남으면 안 된다)", () => {
    const { container, rerender } = render(<RouteWindow win={makeWin({ minimized: true })} />);
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(srcOf(container)).toBeNull();

    useWindowStore.setState({ focusedId: ID }); // restore()가 하는 일
    rerender(<RouteWindow win={makeWin({ minimized: false })} />);
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(srcOf(container)).toBe("/timetable?embed=1");
  });

  it("🔴 한 번 로드한 창은 최소화해도 문서를 버리지 않는다(BL3 warm 풀·스크롤 보존)", () => {
    useWindowStore.setState({ focusedId: ID });
    const { container, rerender } = render(<RouteWindow win={makeWin()} />);
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(srcOf(container)).toBe("/timetable?embed=1");

    rerender(<RouteWindow win={makeWin({ minimized: true })} />); // 최소화 / BL3 close
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(srcOf(container)).toBe("/timetable?embed=1"); // 여전히 살아 있다
  });
});
