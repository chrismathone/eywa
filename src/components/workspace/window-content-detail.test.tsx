import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));
const { toastWarning } = vi.hoisted(() => ({ toastWarning: vi.fn() }));
vi.mock("sonner", () => ({ toast: { warning: toastWarning, info: vi.fn() } }));

import { WindowContent } from "./window-content";
import { MAX_WINDOWS, useWindowStore, windowId } from "./window-store";

/**
 * 원생 요약 창의 '상세 전체보기' — 상세를 라우트 창으로 열고, 요약 창은 닫고, 상세를 앨범(스포트라이트) 위로.
 * - 전수검사 2026-09-11 후속: 창 개수 한도로 상세가 거절돼도 요약 창을 닫고 앨범에 들어가, 볼 것이 아무것도 안 남았다.
 * - 재리뷰 2026-09-11: 곧 닫을 요약 창이 '지금 보는 창'이라 자리를 지키는 바람에, 한도가 차 있으면 상세가 **다른 창을
 *   밀어내거나**(깨끗한 창) **거절됐다**(나머지가 전부 미저장). 요약 창을 먼저 닫아 그 자리로 연다.
 */

const STU = windowId("student", "s1");
const DETAIL = windowId("route", "students/s1");
const M = (i: number) => windowId("route", `m${i}`);

beforeEach(() => {
  toastWarning.mockClear();
  useWindowStore.setState({
    windows: {},
    order: [],
    focusedId: null,
    live: {},
    nav: {},
    reloadNonce: {},
    dirty: {},
    busy: {},
    pendingNav: {},
    homeNonce: {},
    cached: [],
    spotlight: false,
    spotlightRaised: [],
  });
  // 요약 데이터는 안 와도 된다(로딩 중에도 버튼은 있다) — 실제 네트워크로 나가지 않게.
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** 요약 창 말고 창을 한도 하나 모자라게 채운다(요약 창까지 열면 꽉 찬다). */
function fillOthers({ dirty }: { dirty: boolean }) {
  for (let i = 1; i < MAX_WINDOWS; i++) {
    useWindowStore.getState().open("route", { id: `m${i}`, title: `메뉴${i}`, href: `/m${i}` });
    if (dirty) useWindowStore.getState().setWindowDirty(M(i), true);
  }
}

function openSummary() {
  useWindowStore.getState().open("student", { id: "s1", title: "박지율" });
  const win = useWindowStore.getState().windows[STU]!;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <WindowContent win={win} />
    </QueryClientProvider>,
  );
}

describe("원생 요약 창 '상세 전체보기'", () => {
  it("🔴 한도가 차 있어도 곧 닫을 요약 창의 자리로 상세를 연다 — 나머지가 전부 미저장이어도 거절하지 않는다", () => {
    fillOthers({ dirty: true });
    openSummary();

    fireEvent.click(screen.getByText("상세 전체보기"));

    const st = useWindowStore.getState();
    expect(st.windows[DETAIL]).toBeTruthy();
    expect(st.windows[STU]).toBeFalsy();
    for (let i = 1; i < MAX_WINDOWS; i++) expect(st.windows[M(i)]).toBeTruthy(); // 미저장 창은 그대로
    expect(st.order).toHaveLength(MAX_WINDOWS);
    expect(st.spotlightRaised).toEqual([DETAIL]);
    expect(toastWarning).not.toHaveBeenCalled();
  });

  it("🔴 깨끗한 창으로 차 있어도 다른 창을 밀어내지 않는다 — 요약 창이 비키는 자리면 충분하다", () => {
    fillOthers({ dirty: false });
    openSummary();

    fireEvent.click(screen.getByText("상세 전체보기"));

    const st = useWindowStore.getState();
    expect(st.windows[DETAIL]).toBeTruthy();
    expect(st.windows[STU]).toBeFalsy();
    expect(st.windows[M(1)]).toBeTruthy(); // 가장 뒤 창도 살아 있다
    expect(st.order).toHaveLength(MAX_WINDOWS);
  });

  it("자리가 있으면 종전대로 — 상세를 열고 요약은 닫고 상세를 앨범 위로", () => {
    openSummary();

    fireEvent.click(screen.getByText("상세 전체보기"));

    const st = useWindowStore.getState();
    expect(st.windows[DETAIL]).toBeTruthy();
    expect(st.windows[STU]).toBeFalsy();
    expect(st.spotlight).toBe(true);
    expect(st.spotlightRaised).toEqual([DETAIL]);
  });
});
