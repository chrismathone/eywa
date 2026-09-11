import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
  usePathname: () => "/dashboard",
}));

import { FloatingWindow } from "./floating-window";
import { useWindowStore, windowId, type Win } from "./window-store";

/**
 * 창 제목줄 ←(뒤로) — 전수검사 2026-09-11: 뒤로 기록은 iframe의 **실제 주소**를 그대로 적는데, 창 안에서 한
 * 이동(기간 이동 등)이 embed=1을 떨어뜨린 주소가 거기 섞인다. ←가 그 주소를 그대로 열어 **창 안에 풀 셸**이 떴다
 * (메뉴 재클릭·첫 로드·복제는 embed를 붙이는데 ←만 안 붙였다).
 */

const ID = windowId("route", "attendance");
const WIN: Win = {
  id: ID,
  kind: "route",
  params: { id: "attendance", title: "출석부", href: "/attendance" },
  rect: { x: 0, y: 0, w: 900, h: 600 },
  minimized: false,
  maximized: false,
};

/** 지금 창이 보고 있는 상세(뒤로 기록의 맨 위) — iframe의 실제 주소도 이것이다. */
const DETAIL = { pathname: "/attendance/2026-10-02/abc", search: "?embed=1" };

/**
 * 렌더된 창 iframe의 contentWindow를 가짜로 바꿔 `location.replace`를 돌려받는다.
 * ⚠️ 주소는 기록의 맨 위(DETAIL)와 같아야 한다 — RouteWindow의 관찰(sync)이 이 주소를 기록에 보고하므로,
 *    다르면 기록이 한 칸 더 쌓여 ←가 엉뚱한 곳을 가리킨다(실제 창은 늘 기록 맨 위를 보고 있다).
 */
function fakeFrame(container: HTMLElement) {
  const iframe = container.querySelector("iframe");
  if (!iframe) throw new Error("iframe 없음");
  const location = { ...DETAIL, hash: "", href: `http://localhost${DETAIL.pathname}${DETAIL.search}`, replace: vi.fn() };
  // 실제 창처럼 replace하면 iframe 주소가 그리로 옮겨 간다 — 이후 관찰(sync)이 옛 상세를 다시 쌓지 않게.
  location.replace.mockImplementation((url: string) => {
    const u = new URL(url, "http://localhost");
    Object.assign(location, { pathname: u.pathname, search: u.search, hash: u.hash, href: u.href });
  });
  Object.defineProperty(iframe, "contentWindow", { configurable: true, value: { location } });
  return location.replace;
}

beforeEach(() => {
  useWindowStore.setState({
    windows: { [ID]: WIN },
    order: [ID],
    focusedId: ID,
    live: {},
    nav: {},
    reloadNonce: {},
    dirty: {},
    busy: {},
    cached: [],
    spotlight: false,
    spotlightRaised: [],
  });
});

/**
 * 창을 띄우고 가짜 iframe을 꽂은 **뒤에** 뒤로 기록을 심는다.
 * ⚠️ 순서가 중요하다 — 마운트 순간 RouteWindow의 관찰(sync)은 테스트 환경의 진짜 iframe 주소(src)를 기록에
 *    보고한다. 기록을 먼저 심으면 그 보고가 한 칸 더 쌓여 ←가 엉뚱한 곳을 가리킨다.
 */
function openWithHistory(prev: string) {
  const { container } = render(<FloatingWindow win={WIN} focused z={1} />);
  const replace = fakeFrame(container);
  act(() => {
    useWindowStore.setState({
      nav: { [ID]: [prev, `${DETAIL.pathname}${DETAIL.search}`] },
      live: { [ID]: { title: "상세", canBack: true } },
    });
  });
  return replace;
}

describe("창 제목줄 ← 뒤로 — 기록에서 꺼낸 주소에도 embed=1", () => {
  it("🔴 기간을 옮겨 embed가 떨어진 주소로 돌아가도 창용 셸로 연다", () => {
    const replace = openWithHistory("/attendance?teacher=t1&month=2026-10&mode=teacher");

    fireEvent.click(screen.getByLabelText("뒤로"));

    expect(replace).toHaveBeenCalledWith("/attendance?teacher=t1&month=2026-10&mode=teacher&embed=1");
    expect(useWindowStore.getState().live[ID]?.canBack).toBe(false);
  });

  it("이미 embed가 있는 주소는 그대로 — 두 번 붙이지 않는다", () => {
    const replace = openWithHistory("/attendance?embed=1");

    fireEvent.click(screen.getByLabelText("뒤로"));

    expect(replace).toHaveBeenCalledWith("/attendance?embed=1");
  });

  it("🔴 녹음 중이면 ←도 잠긴다 — 새로고침·닫기처럼(옮기면 녹음이 끊긴다, 리뷰 2026-09-11)", () => {
    const replace = openWithHistory("/attendance?embed=1");
    act(() => {
      useWindowStore.getState().setWindowBusy(ID, true);
    });

    const back = screen.getByLabelText("뒤로");
    expect(back).toBeDisabled();
    fireEvent.click(back);

    expect(replace).not.toHaveBeenCalled();
    expect(useWindowStore.getState().nav[ID]).toHaveLength(2);
  });
});
