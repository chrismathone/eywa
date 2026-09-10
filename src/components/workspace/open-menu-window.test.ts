import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useWindowStore, windowId } from "./window-store";
import { openMenuWindow } from "./open-menu-window";

/**
 * **"메뉴를 다시 누르면 첫 화면으로"가 두 입구에서 같아야 한다.**
 *
 * 계기(원장 2026-09-10): *"회의록을 작성 완료하고 분석 끝난 상태에서 다시 메뉴에서 회의록을 누르면
 * 기존 화면이 유지됨. 초기 목록 화면이 아니고"* → *"회의록 뿐만 아니라 다른 메뉴도 그런 버그 있는지"*.
 * 원인은 리셋 규칙이 **사이드바 줄에만** 있었던 것 — 메뉴 판은 `store.open()`만 불러 포커스만 했다.
 */

const MEET = windowId("route", "meetings");

function reset() {
  useWindowStore.setState({
    owner: null,
    windows: {},
    order: [],
    focusedId: null,
    live: {},
    nav: {},
    reloadNonce: {},
    dirty: {},
    cached: [],
    spotlight: false,
    spotlightRaised: [],
  });
}

const PARAMS = { id: "meetings", title: "회의록", href: "/meetings" };

/** 창을 열고 RouteWindow가 첫 URL(루트)을 보고한 상태까지 — 실제 마운트 순서와 같게. */
function openAtRoot() {
  openMenuWindow(PARAMS);
  useWindowStore.getState().observeIframe(MEET, { title: "회의록", url: "/meetings?embed=1" });
}

/** 창 안에서 상세로 드릴인 — iframe URL 변화 보고가 nav 스택을 쌓는 그 경로. */
function drillIn() {
  useWindowStore.getState().observeIframe(MEET, { title: "9월 정기회의", url: "/meetings/abc?embed=1" });
}

describe("openMenuWindow — 메뉴 재클릭은 그 창을 첫 화면으로", () => {
  beforeEach(reset);

  it("드릴인한 창이 최상단이면 nav 스택을 루트 하나로 되돌린다", () => {
    openAtRoot();
    drillIn();
    expect(useWindowStore.getState().nav[MEET]).toHaveLength(2);

    openMenuWindow(PARAMS); // 메뉴를 다시 누름
    expect(useWindowStore.getState().nav[MEET]).toEqual(["/meetings"]);
    expect(useWindowStore.getState().live[MEET]?.canBack).toBe(false);
  });

  it("이미 루트면 아무 일도 안 한다 — 불필요한 리로드·깜빡임 방지", () => {
    openAtRoot();
    const before = useWindowStore.getState().nav[MEET];
    openMenuWindow(PARAMS);
    expect(useWindowStore.getState().nav[MEET]).toEqual(before);
  });

  it("🔴 최상단이 아니면 되돌리지 않는다 — 보고 있던 자리를 잃지 않게 먼저 포커스만", () => {
    openAtRoot();
    drillIn();
    // 다른 창으로 포커스가 옮겨간 상태
    useWindowStore.getState().open("route", { id: "students", title: "학생목록", href: "/students" });
    expect(useWindowStore.getState().focusedId).not.toBe(MEET);

    openMenuWindow(PARAMS);
    expect(useWindowStore.getState().focusedId).toBe(MEET);
    // 자리는 그대로 — 한 번 더 눌러야 첫 화면으로
    expect(useWindowStore.getState().nav[MEET]).toHaveLength(2);
    openMenuWindow(PARAMS);
    expect(useWindowStore.getState().nav[MEET]).toEqual(["/meetings"]);
  });

  it("최소화된 창은 최상단이 아니다 — 되돌리기 전에 먼저 복원한다", () => {
    openAtRoot();
    drillIn();
    useWindowStore.getState().minimize(MEET);

    openMenuWindow(PARAMS);
    expect(useWindowStore.getState().windows[MEET]?.minimized).toBe(false);
    // 화면에 안 보이는 창을 리셋해 봐야 사용자는 못 본다 — 자리는 아직 그대로.
    expect(useWindowStore.getState().nav[MEET]).toHaveLength(2);
  });
});

/**
 * 구조 가드 — 판정이 **한 곳**에 있어야 한다. 이 규칙이 갈렸던 것이 원장 제보의 원인이라,
 * 두 입구가 다시 각자 `store.open("route", …)`을 부르기 시작하면 여기서 막는다.
 */
describe("구조 — 메뉴 입구 둘이 같은 함수를 쓴다", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), "src", p), "utf8");

  it("사이드바 줄과 메뉴 판이 모두 openMenuWindow를 부른다", () => {
    for (const p of ["components/app-sidebar.tsx", "components/workspace/menu-hub-grid.tsx"]) {
      expect(read(p), p).toContain("openMenuWindow(params)");
    }
  });

  it("🔴 homeNav는 openMenuWindow 밖에서 부르지 않는다 — 규칙이 갈리면 같은 버그가 재발한다", () => {
    for (const p of ["components/app-sidebar.tsx", "components/workspace/menu-hub-grid.tsx"]) {
      expect(read(p), p).not.toContain("homeNav(");
    }
  });
});
