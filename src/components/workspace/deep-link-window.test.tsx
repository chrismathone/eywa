import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ pathname: "/dashboard" }));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname }));

import { useWindowStore, windowId } from "./window-store";
import { deepLinkWindow, useDeepLinkWindow } from "./deep-link-window";

/** `/students/<id>` 같은 상세 라우트가 자기 metadata로 다는 제목. */
const DETAIL_TITLE = "학생 상세 — 에이와";
/** 라우트가 제목을 안 달았을 때 남는 루트 레이아웃 기본값. */
const APP_DEFAULT_TITLE = "에이와 — 인재원 학원관리";

describe("deepLinkWindow — 주소로 들어온 라우트를 어떤 창으로 열까", () => {
  it("🔴 상세 라우트는 경로 기반 창 + 문서 제목(원장 제보 2026-09-01, /students/<id>가 빈 바탕이었다)", () => {
    expect(deepLinkWindow("/students/a06433f2-3e35-4f5d-b0d7-c5e50e5e17f4", DETAIL_TITLE)).toEqual({
      id: "students/a06433f2-3e35-4f5d-b0d7-c5e50e5e17f4",
      title: "학생 상세",
    });
  });

  it("메뉴 루트는 사이드바와 **같은 id·같은 제목**(진입 경로가 달라도 창은 한 벌)", () => {
    expect(deepLinkWindow("/students", "원생목록 — 에이와")).toEqual({
      id: "students",
      title: "원생목록",
    });
  });

  it("대시보드는 창으로 복제하지 않고 하위 공지 화면만 창으로 연다", () => {
    expect(deepLinkWindow("/dashboard", "대시보드 — 에이와")).toBeNull();
    expect(deepLinkWindow("/menu", "업무 선택 — 에이와")).toBeNull();
    expect(deepLinkWindow("/dashboard/announcements", "학원 공지 — 에이와")).toEqual({ id: "dashboard/announcements", title: "학원 공지" });
  });

  it("메뉴에 없는 라우트도 창으로 연다(안 열면 그 주소는 빈 바탕)", () => {
    // 하부탭 전용 /mcs는 findNavItem에 없지만 windowIdForHref가 하부탭 목록에서 풀어 메뉴 판이 여는
    // 창(windowId("route","mcs"))과 한 벌로 합쳐진다.
    expect(deepLinkWindow("/mcs", "수학 강사 시트 — 에이와")).toEqual({
      id: "mcs",
      title: "수학 강사 시트",
    });
    expect(deepLinkWindow("/kiosk-settings", "키오스크 설정 — 에이와")?.id).toBe("kiosk-settings");
  });

  it("라우트가 제목을 안 달았으면(루트 기본값) 문서 제목을 믿지 않고 메뉴 라벨로", () => {
    expect(deepLinkWindow("/students/123", APP_DEFAULT_TITLE)).toEqual({
      id: "students/123",
      title: "원생목록",
    });
    // 창 규약에 이름이 있는 라우트(키오스크 설정 — 도움말 링크가 유일한 입구)는 그 이름으로.
    expect(deepLinkWindow("/kiosk-settings", APP_DEFAULT_TITLE)?.title).toBe("키오스크 설정");
    // 메뉴 밖 + 제목도 없으면 마지막 폴백.
    expect(deepLinkWindow("/some-new-route", APP_DEFAULT_TITLE)?.title).toBe("보기");
  });

  it("쿼리·해시는 창 id에서 떨어진다(같은 화면의 필터 차이로 창이 갈리지 않게)", () => {
    expect(deepLinkWindow("/billing?tab=expenses", "수납관리 — 에이와")?.id).toBe("billing");
    expect(deepLinkWindow("/", "에이와")).toBeNull();
  });

  it("🔴 프로토콜 상대 경로는 안 연다 — iframe에 실리면 창틀 안에 남의 사이트가 뜬다", () => {
    expect(deepLinkWindow("//evil.example.com", "무언가 — 에이와")).toBeNull();
    expect(deepLinkWindow("/\\evil.example.com", "무언가 — 에이와")).toBeNull();
  });
});

describe("useDeepLinkWindow — 실제로 창이 열리는가", () => {
  beforeEach(() => {
    navigation.pathname = "/students/abc";
    useWindowStore.setState({ windows: {}, order: [], focusedId: null, cached: [] });
    document.title = DETAIL_TITLE;
    window.history.replaceState({}, "", "/students/abc?tab=progress");
  });

  it("🔴 딥링크로 들어오면 그 라우트가 창으로 뜬다(쿼리까지 실어서)", () => {
    renderHook(() => useDeepLinkWindow(true));
    const id = windowId("route", "students/abc");
    const win = useWindowStore.getState().windows[id];
    expect(win).toBeTruthy();
    expect(win?.params.href).toBe("/students/abc?tab=progress");
    expect(win?.params.title).toBe("학생 상세");
    expect(useWindowStore.getState().focusedId).toBe(id);
  });

  it("🔴 해시는 href에 안 싣는다 — withEmbed가 `?`로만 쪼개 창 안에 풀 셸이 뜬다", () => {
    window.history.replaceState({}, "", "/students/abc#memo");
    renderHook(() => useDeepLinkWindow(true));
    const href = useWindowStore.getState().windows[windowId("route", "students/abc")]?.params.href;
    expect(href).toBe("/students/abc");
  });

  it("enabled=false(모바일·미니셸·운영실)면 아무 창도 안 연다", () => {
    renderHook(() => useDeepLinkWindow(false));
    expect(useWindowStore.getState().order).toHaveLength(0);
  });

  it("이미 그 창이 떠 있으면 창을 두 벌 만들지 않는다(포커스만)", () => {
    renderHook(() => useDeepLinkWindow(true));
    renderHook(() => useDeepLinkWindow(true));
    expect(useWindowStore.getState().order).toHaveLength(1);
  });
});

describe("배선 — 캔버스가 실제로 이 훅을 부르는가", () => {
  it("🔴 main을 덮는 조건과 **같은 조건**으로 호출한다(갈리면 배경과 창이 겹치거나 빈 바탕이 남는다)", () => {
    const src = readFileSync(
      join(process.cwd(), "src/components/workspace/workspace-canvas.tsx"),
      "utf8",
    );
    // 이전 화면 유지 방식은 이 훅 대신 주소 동기화(useKeepaliveFollow)가 딥링크를 연다 — 조건에서 그 방식만 뺀다(keepalive-wiring.test.ts).
    expect(src).toContain("useDeepLinkWindow(isDesktop && !isDesktopSurface && !keepalive)");
  });
});
