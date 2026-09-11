import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/components/workspace/use-is-desktop", () => ({ useIsDesktop: () => true }));
vi.mock("@/features/nav/server/visit-actions", () => ({ recordMenuVisit: vi.fn(async () => {}) }));

import { COMMAND_PALETTE_OPEN_EVENT, CommandPalette } from "./command-palette";
import { useWindowStore, windowId } from "./workspace/window-store";
import { useMenuHub } from "./workspace/menu-hub-store";

/**
 * 검색 팰릿의 데이터 결과(원생·수업 상세)로 창을 열 때 **떠 있던 메뉴 판을 닫는다**(2026-09-11 리뷰).
 * 메뉴 판(z-44)이 창 캔버스(z-40)를 덮고 있어, 판을 두면 방금 연 창이 판 **밑에** 깔려 아무 일도 없던 것처럼 보였다.
 * (메뉴 결과는 `useOpenMenu`가 이미 판을 닫는다 — 데이터 결과만 빠져 있었다.)
 */

const RESULT = {
  hits: [
    { kind: "student", id: "abc", title: "김지유", subtitle: "경명여중1" },
    { kind: "class", id: "c1", title: "중2 수학 심화", subtitle: null },
  ],
  more: [],
};

function renderPalette() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CommandPalette systemRole="master" />
    </QueryClientProvider>,
  );
}

async function searchAndPick(query: string, title: string) {
  act(() => {
    window.dispatchEvent(new Event(COMMAND_PALETTE_OPEN_EVENT));
  });
  // 팝업 제목(sr-only)도 "검색"이라 이름만으론 둘이 걸린다 — 입력 칸은 역할로 집는다.
  fireEvent.change(await screen.findByRole("textbox", { name: "검색" }), { target: { value: query } });
  const hit = await screen.findByText(title);
  fireEvent.click(hit.closest("button")!);
}

describe("검색 팰릿 데이터 결과 — 메뉴 판 위로 창을 연다", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => RESULT })),
    );
    useWindowStore.setState({ windows: {}, order: [], focusedId: null, live: {}, nav: {}, cached: [] });
    useMenuHub.setState({ groupId: "student" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("🔴 원생 결과(요약 창)를 열면 메뉴 판을 닫는다", async () => {
    renderPalette();
    await searchAndPick("김지", "김지유");
    expect(useWindowStore.getState().windows[windowId("student", "abc")]).toBeTruthy();
    expect(useMenuHub.getState().groupId).toBeNull();
  });

  it("🔴 수업 결과(상세 창)를 열어도 메뉴 판을 닫는다", async () => {
    renderPalette();
    await searchAndPick("중2", "중2 수학 심화");
    expect(useWindowStore.getState().windows[windowId("route", "classes/c1")]).toBeTruthy();
    expect(useMenuHub.getState().groupId).toBeNull();
  });
});
