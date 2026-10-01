import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ pathname: "/students/abc" }));
vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSelectedLayoutSegments: () => [], // 이전 화면 유지 방식의 바탕 판정용(창 모드에선 안 쓴다)
}));

import { WorkspaceCanvas } from "./workspace-canvas";
import { useWindowStore, windowId } from "./window-store";

const OWNER = "t1:u1";

/** 지난 세션에 열려 있던 창들 — persist가 읽는 그 키에 그대로 심는다. */
function seedPersisted(ids: string[]) {
  const windows = Object.fromEntries(
    ids.map((raw) => {
      const id = windowId("route", raw);
      return [
        id,
        {
          id,
          kind: "route",
          params: { id: raw, title: raw, href: `/${raw}` },
          rect: { x: 20, y: 20, w: 600, h: 500 },
          minimized: false,
          maximized: false,
        },
      ];
    }),
  );
  const order = ids.map((raw) => windowId("route", raw));
  localStorage.setItem(
    "eywa-workspace",
    JSON.stringify({
      state: { owner: OWNER, windows, order, focusedId: order[order.length - 1] ?? null },
      version: 0,
    }),
  );
}

describe("캔버스 통합 — 딥링크 창이 복원된 창들 위로 오는가", () => {
  beforeEach(() => {
    navigation.pathname = "/students/abc";
    document.title = "학생 상세 — 에이와";
    window.history.replaceState({}, "", "/students/abc");
    localStorage.clear();
    useWindowStore.setState({
      owner: null,
      windows: {},
      order: [],
      focusedId: null,
      cached: [],
      spotlight: false,
      spotlightRaised: [],
    });
    // 데스크톱(≥1024 + 마우스)으로 인식되게.
    window.matchMedia = ((q: string) => ({
      matches: true,
      media: q,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  });

  it("🔴 복원 창 3개 위에 뜬다(원장 제보 2026-09-01 '다른 창들에 묻혀버린다')", async () => {
    seedPersisted(["timetable", "attendance", "classes"]);
    await useWindowStore.persist.rehydrate();

    render(<WorkspaceCanvas owner={OWNER} />);

    const id = windowId("route", "students/abc");
    await waitFor(() => {
      expect(useWindowStore.getState().windows[id]).toBeTruthy();
    });
    const { order, focusedId } = useWindowStore.getState();
    expect(order).toHaveLength(4);
    expect(order[order.length - 1]).toBe(id);
    expect(focusedId).toBe(id);
  });

  it("🔴 하이드레이션이 **마운트 중**에 끝나도(실제 순서) 맨 위로 온다", async () => {
    seedPersisted(["timetable", "attendance", "classes"]);
    // await 하지 않는다 — 모듈 로드 시점의 rehydrate가 마운트와 겹치는 상황.
    void useWindowStore.persist.rehydrate();
    render(<WorkspaceCanvas owner={OWNER} />);

    const id = windowId("route", "students/abc");
    await waitFor(() => {
      expect(useWindowStore.getState().windows[id]).toBeTruthy();
    });
    const { order, focusedId } = useWindowStore.getState();
    expect(order).toHaveLength(4);
    expect(order[order.length - 1]).toBe(id);
    expect(focusedId).toBe(id);
  });
});
