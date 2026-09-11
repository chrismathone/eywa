import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useWindowStore, windowId } from "./window-store";
import { openMenuWindow } from "./open-menu-window";
import { iframeRegistry } from "./route-window";

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
 * 면(face) — 부모 메뉴 창을 같이 쓰는 목적지(오늘 출결·설정 11면·수납 면·셔틀 면).
 * 계기(원장 2026-09-11 캡처): 수업 메뉴 판 '도구 > 오늘 출결'을 눌렀는데 월별 출석부가 떴다.
 */
describe("openMenuWindow — 같은 창을 쓰는 다른 주소(면)는 그 주소로 간다", () => {
  beforeEach(reset);

  const ATT = windowId("route", "attendance");
  const MONTHLY = { id: "attendance", title: "출석부", href: "/attendance" };
  const LIVE = { id: "attendance", title: "오늘 출결", href: "/attendance/live" };

  function openMonthlyAtRoot() {
    openMenuWindow(MONTHLY);
    useWindowStore.getState().observeIframe(ATT, { title: "출석부", url: "/attendance?embed=1" });
  }

  it("🔴 부모 창이 맨 앞이어도 면 버튼은 그 면으로 간다 — 무시하거나 부모 첫 화면으로 되돌리지 않는다", () => {
    openMonthlyAtRoot();
    expect(useWindowStore.getState().focusedId).toBe(ATT);

    openMenuWindow(LIVE);
    const w = useWindowStore.getState().windows[ATT];
    expect(w?.params.href).toBe("/attendance/live");
    expect(w?.params.title).toBe("오늘 출결");
    expect(useWindowStore.getState().focusedId).toBe(ATT);
  });

  it("🔴 면을 연 뒤 부모 버튼을 누르면 부모 주소로 돌아간다 — 창의 첫 화면이 면에 묶이지 않는다", () => {
    openMonthlyAtRoot();
    // 출석부 창이 뒤에 있을 때 면을 열면 `open()`이 창의 첫 화면(params.href)을 면 주소로 바꾼다.
    useWindowStore.getState().open("route", { id: "students", title: "원생목록", href: "/students" });
    openMenuWindow(LIVE);
    expect(useWindowStore.getState().windows[ATT]?.params.href).toBe("/attendance/live");
    useWindowStore.getState().observeIframe(ATT, { title: "오늘 출결", url: "/attendance/live?embed=1" });

    openMenuWindow(MONTHLY); // 이제 맨 앞인 그 창에서 부모 버튼
    expect(useWindowStore.getState().windows[ATT]?.params.href).toBe("/attendance");
  });

  it("드릴인한 상태에서도 면 버튼은 그 면으로 간다", () => {
    openMonthlyAtRoot();
    useWindowStore.getState().observeIframe(ATT, { title: "9월 출석부", url: "/attendance/2026-09-11/abc?embed=1" });

    openMenuWindow(LIVE);
    expect(useWindowStore.getState().windows[ATT]?.params.href).toBe("/attendance/live");
  });

  it("쿼리로 가르는 면(설정 11면)도 같다 — 지금 보는 면과 다르면 그 면으로", () => {
    const OWNER = windowId("route", "owner");
    openMenuWindow({ id: "owner", title: "프로필·브랜드", href: "/owner" });
    useWindowStore.getState().observeIframe(OWNER, { title: "학원 설정", url: "/owner?embed=1" });

    openMenuWindow({ id: "owner", title: "수납·청구", href: "/owner?tab=billing" });
    expect(useWindowStore.getState().windows[OWNER]?.params.href).toBe("/owner?tab=billing");
  });

  it("같은 면을 다시 누르면 종전 규칙 그대로 — 그 면의 첫 화면으로 되돌린다", () => {
    openMonthlyAtRoot();
    openMenuWindow(LIVE);
    useWindowStore.getState().observeIframe(ATT, { title: "오늘 출결", url: "/attendance/live?embed=1" });
    useWindowStore.getState().observeIframe(ATT, { title: "상세", url: "/attendance/2026-09-11/abc?embed=1" });

    openMenuWindow(LIVE);
    expect(useWindowStore.getState().nav[ATT]).toEqual(["/attendance/live"]);
  });

  it("🔴 면으로 옮긴 창은 새 문서의 첫 로드에서 뒤로 기록을 새로 시작한다 — 첫 화면에 ←가 안 서고, 다시 눌러도 새로고침하지 않는다", () => {
    openMonthlyAtRoot();
    openMenuWindow(LIVE);
    // RouteWindow: 주소가 바뀐 뒤 새 문서의 첫 로드 → reset 보고
    useWindowStore.getState().observeIframe(ATT, { title: "오늘 출결", url: "/attendance/live?embed=1", reset: true });
    expect(useWindowStore.getState().nav[ATT]).toEqual(["/attendance/live?embed=1"]);
    expect(useWindowStore.getState().live[ATT]?.canBack).toBe(false);

    const replace = vi.fn();
    iframeRegistry.set(ATT, { contentWindow: { location: { replace } } } as unknown as HTMLIFrameElement);
    try {
      openMenuWindow(LIVE); // 이미 그 면의 첫 화면 — 아무 일도 안 한다(09-10 규칙)
      expect(replace).not.toHaveBeenCalled();
    } finally {
      iframeRegistry.delete(ATT);
    }
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

  it("🔴 RouteWindow는 주소가 바뀐 뒤 **새 문서의 첫 로드**에서만 스택을 새로 시작한다 — 옛 문서의 즉시 sync로 비우면 옛 주소가 다시 쌓인다", () => {
    const src = read("components/workspace/route-window.tsx");
    expect(src).toContain("prevHrefRef.current !== href");
    expect(src).toContain("if (sync(resetOnLoadRef.current)) resetOnLoadRef.current = false;");
    // 인자를 넘기는 콜백이 reset으로 읽히면 드릴인·뒤로 가기마다 스택이 지워진다.
    expect(src).toContain("new MutationObserver(syncPlain)");
    expect(src).toContain('addEventListener("popstate", syncPlain)');
  });
});
