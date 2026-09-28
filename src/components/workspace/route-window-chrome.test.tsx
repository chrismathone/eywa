import { act, fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

import { RouteWindow, reloadTarget } from "./route-window";
import { useWindowStore, windowId, type Win } from "./window-store";

describe("reloadTarget — ⟳가 갈 주소", () => {
  it("embed가 있으면 null(그대로 reload), 없으면 붙인다 — 쿼리·해시는 보존", () => {
    expect(reloadTarget({ pathname: "/x", search: "?a=1&embed=1", hash: "" })).toBeNull();
    expect(reloadTarget({ pathname: "/x", search: "?a=1", hash: "#top" })).toBe("/x?a=1&embed=1#top");
    expect(reloadTarget({ pathname: "/x", search: "", hash: "" })).toBe("/x?embed=1");
  });

  it("라우트를 싣기 전(about:blank)엔 손대지 않는다", () => {
    expect(reloadTarget({ pathname: "blank", search: "", hash: "" })).toBeNull();
  });
});

/**
 * 창 크롬이 iframe을 다시 부르는 경로 — ⟳(이 창만 새로고침)와 녹음 잠금 신호.
 */

const HREF = "/attendance";
const ID = windowId("route", "attendance");

function makeWin(): Win {
  return {
    id: ID,
    kind: "route",
    params: { id: "attendance", title: "출석부", href: HREF },
    rect: { x: 0, y: 0, w: 800, h: 600 },
    minimized: false,
    maximized: false,
  };
}

type FakeLoc = { pathname: string; search: string; hash?: string };

/**
 * 렌더된 iframe의 contentWindow를 가짜로 바꾼다 — 실제 문서 이동 대신 호출만 본다.
 * `fire(type)` = 그 문서의 이벤트(pagehide 등)를 흉내 낸다. `title`을 주면 문서(contentDocument)도 가짜로 — 관찰(sync)이 보고한다.
 */
function fakeFrame(container: HTMLElement, loc: FakeLoc, title?: string) {
  const iframe = container.querySelector("iframe");
  if (!iframe) throw new Error("iframe 없음");
  const replace = vi.fn();
  const reload = vi.fn();
  const listeners: Record<string, Array<() => void>> = {};
  const frameWin = {
    location: { hash: "", href: `http://localhost${loc.pathname}${loc.search}`, ...loc, replace, reload },
    addEventListener: (type: string, cb: () => void) => {
      (listeners[type] ??= []).push(cb);
    },
    removeEventListener: (type: string, cb: () => void) => {
      listeners[type] = (listeners[type] ?? []).filter((x) => x !== cb);
    },
    // 창이 앞으로 오면 키보드 초점이 iframe으로 간다(use-window-signals) — 그때 React가 초점 요소를 iframe 안까지
    // 따라 들어가며 `contentWindow.HTMLIFrameElement`를 본다. 진짜 창엔 있는 생성자들이라 가짜에도 싣는다.
    // (`document`가 없으면 React가 바깥 문서의 초점 = 이 iframe을 다시 집어 무한히 돈다.)
    HTMLIFrameElement: window.HTMLIFrameElement,
    document: { activeElement: null, body: null },
    Document: window.Document,
    Event: window.Event,
    postMessage: vi.fn(),
  };
  Object.defineProperty(iframe, "contentWindow", { configurable: true, value: frameWin });
  if (title !== undefined) {
    Object.defineProperty(iframe, "contentDocument", {
      configurable: true,
      value: { title, head: document.createElement("head") },
    });
  }
  const fire = (type: string) => [...(listeners[type] ?? [])].forEach((cb) => cb());
  return { replace, reload, frameWin, fire, iframe };
}

beforeEach(() => {
  // 포커스 창은 즉시 활성화(iframe src가 바로 붙는다) — stagger 대기 없이 ⟳가 실제로 돈다.
  // 창이 스토어에 있어야 한다 — 없는 창의 보고·잠금은 스토어가 버린다(리뷰 2026-09-11).
  useWindowStore.setState({
    windows: { [ID]: makeWin() },
    order: [ID],
    focusedId: ID,
    cached: [],
    reloadNonce: {},
    homeNonce: {},
    pendingNav: {},
    live: {},
    nav: {},
    dirty: {},
    busy: {},
    spotlight: false,
    spotlightRaised: [],
  });
});

/**
 * ⟳ — 전수검사 2026-09-11: `location.reload()`는 **지금 주소 그대로** 다시 불러온다. 창 안 이동이 embed=1을
 * 떨어뜨린 문서였으면 새로고침한 창에 풀 셸이 떴다(←와 같은 결함).
 */
describe("RouteWindow ⟳ — 새로고침도 창용 셸(embed=1)로", () => {
  it("🔴 embed가 떨어진 문서를 새로고침하면 embed를 붙인 같은 주소로 다시 연다", () => {
    const { container } = render(<RouteWindow win={makeWin()} />);
    const { replace, reload } = fakeFrame(container, { pathname: "/attendance", search: "?month=2026-10" });

    act(() => useWindowStore.getState().reloadWindow(ID));

    expect(replace).toHaveBeenCalledWith("/attendance?month=2026-10&embed=1");
    expect(reload).not.toHaveBeenCalled();
  });

  it("embed가 있는 문서는 종전대로 reload() — 스크롤 보존", () => {
    const { container } = render(<RouteWindow win={makeWin()} />);
    const { replace, reload } = fakeFrame(container, { pathname: "/attendance", search: "?month=2026-10&embed=1" });

    act(() => useWindowStore.getState().reloadWindow(ID));

    expect(reload).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
  });
});

/**
 * 녹음 잠금 — 창 id를 **경로로 추측하면 드릴인에서 없는 창을 잠근다**([[#69]] ①과 같은 함정). 상세 창
 * (`route:enrollment/abc`) 안에서 수정으로 들어가 녹음하면 경로는 `/enrollment/abc/edit`라, 경로로 만든 id
 * (`route:enrollment/abc/edit`)가 잠기고 **녹음 중인 진짜 창은 닫기·창 개수 한도 축출에 그대로 노출**됐다.
 * 그래서 이 창의 iframe이 보낸 신호를 RouteWindow가 직접 받아 자기 id에 싣는다.
 */
describe("RouteWindow — 녹음 잠금은 이 창의 iframe이 보낸 것만 이 창에 싣는다", () => {
  const busyMessage = (source: unknown, active: boolean) =>
    new MessageEvent("message", {
      data: { type: "eywa-window-busy", active },
      origin: window.location.origin,
      source: source as Window,
    });

  it("🔴 iframe이 보낸 잠금·해제를 이 창 id에 싣는다", () => {
    const { container } = render(<RouteWindow win={makeWin()} />);
    const { frameWin } = fakeFrame(container, { pathname: "/attendance/abc/edit", search: "?embed=1" });

    act(() => {
      window.dispatchEvent(busyMessage(frameWin, true));
    });
    expect(useWindowStore.getState().busy[ID]).toBe(true);

    act(() => {
      window.dispatchEvent(busyMessage(frameWin, false));
    });
    expect(useWindowStore.getState().busy[ID]).toBeUndefined();
  });

  it("다른 문서(다른 창·다른 출처)가 보낸 신호는 무시한다", () => {
    const { container } = render(<RouteWindow win={makeWin()} />);
    fakeFrame(container, { pathname: "/attendance", search: "?embed=1" });

    act(() => {
      window.dispatchEvent(busyMessage({ other: true }, true));
    });
    expect(useWindowStore.getState().busy[ID]).toBeUndefined();
  });
});

/**
 * 스켈레톤 — 문서가 **실제로** 바뀔 때만 덮는다(리뷰 2026-09-11).
 * - 미저장 창의 ⟳: 떠나기 확인에서 '머무르기'면 문서가 그대로인데, 이동 전에 덮으면 스켈레톤이 폼을 영구히 가렸다.
 * - 보관 창을 첫 화면으로 되살릴 때·다른 화면(면)으로 옮길 때: 새 문서가 뜨기 전 옛 상세가 보이고 눌렸다.
 */
describe("RouteWindow 스켈레톤 — 문서가 실제로 바뀔 때만 덮는다", () => {
  const skeleton = (c: HTMLElement) => c.querySelector(".animate-pulse");
  const DETAIL = { pathname: "/attendance/2026-10-02/abc", search: "?embed=1" };

  it("🔴 미저장 창의 ⟳ — '머무르기'면 폼이 그대로 보이고, 문서가 실제로 내려갈 때 덮는다", () => {
    const { container } = render(<RouteWindow win={makeWin()} />);
    const f = fakeFrame(container, { pathname: "/attendance", search: "?embed=1" });
    act(() => {
      fireEvent.load(f.iframe);
    });
    expect(skeleton(container)).toBeNull();

    act(() => {
      useWindowStore.getState().setWindowDirty(ID, true);
      useWindowStore.getState().reloadWindow(ID);
    });
    expect(f.reload).toHaveBeenCalledTimes(1);
    expect(skeleton(container)).toBeNull(); // 떠나기 확인 중 · '머무르기'

    act(() => f.fire("pagehide")); // '떠나기' — 문서가 실제로 내려간다
    expect(skeleton(container)).not.toBeNull();
  });

  it("깨끗한 창의 ⟳는 종전대로 바로 덮는다(누른 느낌)", () => {
    const { container } = render(<RouteWindow win={makeWin()} />);
    const f = fakeFrame(container, { pathname: "/attendance", search: "?embed=1" });
    act(() => {
      fireEvent.load(f.iframe);
    });

    act(() => useWindowStore.getState().reloadWindow(ID));

    expect(f.reload).toHaveBeenCalledTimes(1);
    expect(skeleton(container)).not.toBeNull();
  });

  it("🔴 보관 창을 첫 화면으로 되살리면 스켈레톤으로 덮고 그 창 iframe만 첫 화면으로 옮긴다", () => {
    const { container } = render(<RouteWindow win={makeWin()} />);
    const f = fakeFrame(container, DETAIL);
    act(() => {
      fireEvent.load(f.iframe);
    });
    act(() => {
      useWindowStore.setState({ nav: { [ID]: ["/attendance?embed=1", `${DETAIL.pathname}${DETAIL.search}`] } });
      useWindowStore.getState().close(ID); // 상세에서 닫음 → 보관
    });

    act(() => {
      useWindowStore.getState().open("route", { id: "attendance", title: "출석부", href: HREF }); // 어느 입구든
    });

    expect(f.replace).toHaveBeenCalledWith("/attendance?embed=1");
    expect(skeleton(container)).not.toBeNull();
  });

  it("🔴 다른 화면(면)으로 옮기면 새 문서가 뜰 때까지 덮고, 옛 문서의 보고가 ←를 되살리지 않는다", () => {
    const { container, rerender } = render(<RouteWindow win={makeWin()} />);
    const f = fakeFrame(container, DETAIL, "상세 — 에이와");
    act(() => {
      fireEvent.load(f.iframe);
    });
    act(() => {
      useWindowStore.setState({
        nav: { [ID]: ["/attendance?embed=1", `${DETAIL.pathname}${DETAIL.search}`] },
        live: { [ID]: { title: "상세", canBack: true } },
      });
    });

    act(() => {
      useWindowStore.getState().open("route", { id: "attendance", title: "오늘 출결", href: "/attendance/live" });
      rerender(<RouteWindow win={useWindowStore.getState().windows[ID]!} />);
    });

    expect(skeleton(container)).not.toBeNull();
    expect(useWindowStore.getState().live[ID]?.canBack).toBe(false);
    expect(useWindowStore.getState().nav[ID]).toEqual(["/attendance/live"]);
  });

  it("🔴 미저장 창은 다른 화면으로 옮길 때 바로 덮지 않고, '떠나기'로 문서가 실제로 내려갈 때 덮는다", () => {
    const { container, rerender } = render(<RouteWindow win={makeWin()} />);
    const f = fakeFrame(container, DETAIL);
    act(() => {
      fireEvent.load(f.iframe);
    });

    act(() => {
      useWindowStore.getState().setWindowDirty(ID, true);
      rerender(<RouteWindow win={{ ...makeWin(), params: { ...makeWin().params, href: "/attendance/live" } }} />);
    });
    expect(skeleton(container)).toBeNull(); // 떠나기 확인 중 · '머무르기'면 폼이 그대로 보여야 한다

    act(() => f.fire("pagehide")); // '떠나기' — 새 문서가 뜰 때까지 옛 폼이 보이거나 눌리지 않게
    expect(skeleton(container)).not.toBeNull();
  });

  it("🔴 해시만 다른 화면으로 옮기면 덮지 않는다 — 새 문서 로드가 없어 스켈레톤이 영영 안 걷힌다", () => {
    const { container, rerender } = render(<RouteWindow win={makeWin()} />);
    const f = fakeFrame(container, { pathname: "/attendance", search: "?embed=1" });
    act(() => {
      fireEvent.load(f.iframe);
    });

    act(() => {
      rerender(<RouteWindow win={{ ...makeWin(), params: { ...makeWin().params, href: "/attendance#today" } }} />);
    });

    expect(skeleton(container)).toBeNull();
  });

  it("🔴 첫 화면 표식도 해시만 다르면 덮지 않는다(옮기기는 한다 — 그 자리로 스크롤)", () => {
    const win: Win = { ...makeWin(), params: { ...makeWin().params, href: "/attendance#today" } };
    const { container } = render(<RouteWindow win={win} />);
    const f = fakeFrame(container, { pathname: "/attendance", search: "?embed=1" });
    act(() => {
      fireEvent.load(f.iframe);
    });

    act(() => {
      useWindowStore.setState({ homeNonce: { [ID]: 1 } });
    });

    expect(f.replace).toHaveBeenCalledWith("/attendance?embed=1#today");
    expect(skeleton(container)).toBeNull();
  });
});

/**
 * 녹음 잠금은 창이 **사라질 때** 풀린다(재리뷰 2026-09-11). 폭이 1024 아래로 줄어 캔버스가 창을 전부 언마운트하면 iframe도
 * 파괴되고, 해제 신호(pagehide의 active:false)를 받을 리스너가 없어 잠금이 영영 남았다 — 폭을 되돌리면 그 창의 닫기·
 * 새로고침·뒤로·다른 화면 이동이 잠기고 창 개수 한도의 축출에서도 빠진 채, 탭을 새로고침하기 전엔 못 풀었다.
 */
describe("RouteWindow — 녹음 잠금은 창이 사라질 때 풀린다", () => {
  const busyOn = (frameWin: unknown) =>
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "eywa-window-busy", active: true },
          origin: window.location.origin,
          source: frameWin as Window,
        }),
      );
    });

  it("🔴 창이 언마운트되면(폭이 줄어 창 시스템이 내려감 등) 잠금을 푼다", () => {
    const { container, unmount } = render(<RouteWindow win={makeWin()} />);
    const f = fakeFrame(container, { pathname: "/attendance", search: "?embed=1" });
    busyOn(f.frameWin);
    expect(useWindowStore.getState().busy[ID]).toBe(true);

    unmount();

    expect(useWindowStore.getState().busy[ID]).toBeUndefined();
  });

  it("🔴 녹음 중에 다시 그려져도(제목·주소 변경) 잠금은 그대로다 — 언마운트 때만 푼다", () => {
    const { container, rerender } = render(<RouteWindow win={makeWin()} />);
    const f = fakeFrame(container, { pathname: "/attendance", search: "?embed=1" });
    busyOn(f.frameWin);

    rerender(
      <RouteWindow
        win={{ ...makeWin(), params: { ...makeWin().params, title: "출석부 — 9월", href: "/attendance?month=2026-09" } }}
      />,
    );

    expect(useWindowStore.getState().busy[ID]).toBe(true);
  });
});
