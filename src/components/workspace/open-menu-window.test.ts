import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useWindowStore, windowId } from "./window-store";
import { openLinkWindow, openMenuWindow } from "./open-menu-window";
import { iframeRegistry } from "./route-window";

// 녹음 중인 창을 옮기지 않았다는 안내(sonner) — 실제 토스트 대신 호출만 본다.
const { toastWarning } = vi.hoisted(() => ({ toastWarning: vi.fn() }));
vi.mock("sonner", () => ({ toast: { warning: toastWarning, info: vi.fn() } }));

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
    busy: {},
    pendingNav: {},
    homeNonce: {},
    cached: [],
    spotlight: false,
    spotlightRaised: [],
  });
}

const PARAMS = { id: "meetings", title: "회의록", href: "/meetings" };

/** 창 iframe 자리에 가짜를 꽂고 `location.replace` 호출을 돌려받는다(실제 문서 이동 대신). */
function fakeFrame(winId: string) {
  const replace = vi.fn();
  iframeRegistry.set(winId, { contentWindow: { location: { replace } } } as unknown as HTMLIFrameElement);
  return replace;
}

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
 * 계기(원장 2026-11-02): 운영실 미수강 → 학생 → 퇴원보고서로 들어간 뒤 미수강을 다시 누르면 계속 퇴원보고서가 떴다.
 */
describe("창이 안에서 다른 화면으로 옮겨 간 뒤", () => {
  beforeEach(reset);

  const STU = windowId("route", "students");
  const LINK = { id: "students", title: "원생목록", href: "/students?status=enrolled&subject=none" };
  const MENU = { id: "students", title: "원생목록", href: "/students" };

  function drifted(params: { id: string; title: string; href: string }) {
    const store = useWindowStore.getState();
    openLinkWindow(params);
    store.observeIframe(STU, { title: "원생목록", url: `${params.href}${params.href.includes("?") ? "&" : "?"}embed=1` });
    store.observeIframe(STU, { title: "학생", url: "/students/abc?embed=1" });
    store.observeIframe(STU, { title: "퇴원보고서", url: "/withdrawal-reports?request=abc&embed=1" });
    store.showDesktop();
  }

  it("같은 링크를 다시 누르면 머물던 화면이 아니라 그 링크의 주소로 간다", () => {
    drifted(LINK);
    const replace = fakeFrame(STU);
    openLinkWindow(LINK);
    const st = useWindowStore.getState();
    expect(st.focusedId).toBe(STU);
    expect(st.windows[STU]?.minimized).toBe(false);
    expect(st.nav[STU]).toEqual([LINK.href]);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace.mock.calls[0]![0]).toContain("subject=none");
  });
  it("이미 그 주소면 다시 불러오지 않는다", () => {
    openLinkWindow(LINK);
    useWindowStore.getState().observeIframe(STU, { title: "원생목록", url: `${LINK.href}&embed=1` });
    const replace = fakeFrame(STU);
    openLinkWindow(LINK);
    expect(replace).not.toHaveBeenCalled();
  });
  it("🔴 녹음 중인 창은 링크로도 옮기지 않는다", () => {
    drifted(LINK);
    const replace = fakeFrame(STU);
    useWindowStore.getState().setWindowBusy(STU, true);
    openLinkWindow(LINK);
    expect(replace).not.toHaveBeenCalled();
    expect(toastWarning).toHaveBeenCalled();
  });
  it("미저장 창은 떠나기 확인이 지키도록 기록을 미리 지우지 않는다", () => {
    drifted(LINK);
    const replace = fakeFrame(STU);
    useWindowStore.getState().setWindowDirty(STU, true);
    openLinkWindow(LINK);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(useWindowStore.getState().nav[STU]).toHaveLength(3);
    expect(useWindowStore.getState().pendingNav[STU]).toBeDefined();
  });
  it("메뉴를 눌러도 다른 메뉴의 화면에 머물지 않고 그 메뉴의 첫 화면으로 간다", () => {
    drifted(MENU);
    const replace = fakeFrame(STU);
    openMenuWindow(MENU);
    expect(useWindowStore.getState().nav[STU]).toEqual(["/students"]);
    expect(replace).toHaveBeenCalledTimes(1);
  });
  it("같은 메뉴 안의 상세는 메뉴로 돌아와도 보던 자리를 지킨다", () => {
    openMenuWindow(MENU);
    const store = useWindowStore.getState();
    store.observeIframe(STU, { title: "원생목록", url: "/students?embed=1" });
    store.observeIframe(STU, { title: "학생", url: "/students/abc?embed=1" });
    store.showDesktop();
    const replace = fakeFrame(STU);
    openMenuWindow(MENU);
    expect(useWindowStore.getState().nav[STU]).toHaveLength(2);
    expect(replace).not.toHaveBeenCalled();
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
 * 닫았다가 다시 연 메뉴 — 전수검사 2026-09-11: 닫은 라우트 창은 빠른 재오픈용으로 iframe째 숨겨 보관(BL3)되는데,
 * 메뉴로 다시 열면 **닫기 전 상세 화면**과 ←가 그대로 떴다(한 번 더 눌러야 목록). 원장 결정 = **첫 화면으로**
 * (09-10 "메뉴 누르면 초기 목록"과 같은 결). 첫 화면에서 닫은 창은 지금처럼 즉시 보인다(보관의 속도 이점).
 */
describe("openMenuWindow — 닫은 메뉴(보관 창)를 다시 열면 첫 화면으로", () => {
  beforeEach(reset);
  afterEach(() => iframeRegistry.clear());

  it("🔴 상세에서 닫은 창을 메뉴로 다시 열면 첫 화면(목록)으로 — ← 없음", () => {
    openAtRoot();
    drillIn();
    const replace = fakeFrame(MEET);
    useWindowStore.getState().close(MEET);
    expect(useWindowStore.getState().cached).toContain(MEET);

    openMenuWindow(PARAMS);

    const st = useWindowStore.getState();
    expect(st.windows[MEET]?.minimized).toBe(false);
    expect(st.focusedId).toBe(MEET);
    expect(st.nav[MEET]).toEqual(["/meetings"]);
    expect(st.live[MEET]?.canBack).toBe(false);
    // 옮기는 일은 스토어 표식을 받은 RouteWindow가 한다(스켈레톤 + 그 창 iframe만 — route-window-chrome 테스트).
    // 규칙이 스토어에 있어야 창 링크·알림·인쇄로 되살려도 같다 — 여기서 또 옮기면 두 번 불러온다.
    expect(st.homeNonce[MEET]).toBe(1);
    expect(replace).not.toHaveBeenCalled();
  });

  it("첫 화면에서 닫은 창은 다시 불러오지 않고 즉시 보인다 — 보관의 속도 이점", () => {
    openAtRoot();
    const replace = fakeFrame(MEET);
    useWindowStore.getState().close(MEET);

    openMenuWindow(PARAMS);

    expect(useWindowStore.getState().windows[MEET]?.minimized).toBe(false);
    expect(useWindowStore.getState().homeNonce[MEET]).toBeUndefined();
    expect(replace).not.toHaveBeenCalled();
  });

  it("다른 주소(면)로 되살리면 open()이 그 주소로 보낸다 — 두 번 불러오지 않는다", () => {
    const ATT = windowId("route", "attendance");
    openMenuWindow({ id: "attendance", title: "출석부", href: "/attendance" });
    useWindowStore.getState().observeIframe(ATT, { title: "출석부", url: "/attendance?embed=1" });
    useWindowStore.getState().observeIframe(ATT, { title: "상세", url: "/attendance/2026-09-11/abc?embed=1" });
    const replace = fakeFrame(ATT);
    useWindowStore.getState().close(ATT);

    openMenuWindow({ id: "attendance", title: "오늘 출결", href: "/attendance/live" });

    expect(useWindowStore.getState().windows[ATT]?.params.href).toBe("/attendance/live");
    expect(replace).not.toHaveBeenCalled(); // iframe src 교체(RouteWindow)가 이미 그 주소로 간다
  });
});

/**
 * 스포트라이트(앨범) 중엔 **위로 올라온 창만** 보인다 — 포커스를 받았어도 가려진 창(opacity 0)은 맨 앞이 아니다.
 * 전수검사 2026-09-11: 가려진 창을 '맨 앞'으로 보고 보이지도 않는 창의 자리(상세)를 첫 화면으로 날렸다.
 */
describe("openMenuWindow — 스포트라이트 중 '맨 앞' 판정", () => {
  beforeEach(reset);
  afterEach(() => iframeRegistry.clear());

  it("🔴 포커스만 받고 가려진 창은 되돌리지 않고 앨범 위로 올린다", () => {
    const STU = windowId("route", "students");
    openAtRoot();
    drillIn();
    useWindowStore.getState().open("route", { id: "students", title: "원생목록", href: "/students" });
    // 원생목록만 위 — 회의록은 포커스를 받았는데 위에 없는 상태(옛 open()이 만들던 모양)
    useWindowStore.setState({ spotlight: true, spotlightRaised: [STU], focusedId: MEET });
    const replace = fakeFrame(MEET);

    openMenuWindow(PARAMS);

    const st = useWindowStore.getState();
    expect(st.spotlightRaised).toContain(MEET);
    expect(st.nav[MEET]).toHaveLength(2); // 보고 있던 자리는 그대로 — 올라온 뒤 한 번 더 누르면 첫 화면
    expect(replace).not.toHaveBeenCalled();
  });

  it("위로 올라와 있는 창은 종전대로 — 다시 누르면 첫 화면으로", () => {
    openAtRoot();
    drillIn();
    useWindowStore.getState().enterSpotlight(MEET);
    const replace = fakeFrame(MEET);

    openMenuWindow(PARAMS);

    expect(useWindowStore.getState().nav[MEET]).toEqual(["/meetings"]);
    expect(replace).toHaveBeenCalledWith("/meetings?embed=1");
  });
});

/**
 * 녹음 중·미저장 창을 메뉴로 다시 눌렀을 때 — 리뷰 2026-09-11: 첫 화면 이동이 녹음 중인 창에도 걸렸고, 미저장 창에선
 * 이동 **전에** 기록을 바꿔 떠나기 확인에서 '머무르기'를 고르면 기록과 화면이 어긋났다.
 */
describe("openMenuWindow — 녹음 중·미저장 창을 다시 눌렀을 때", () => {
  beforeEach(() => {
    reset();
    toastWarning.mockClear();
  });
  afterEach(() => iframeRegistry.clear());

  it("🔴 녹음 중인 창은 첫 화면으로 옮기지 않고 이유를 알린다", () => {
    openAtRoot();
    drillIn();
    useWindowStore.getState().setWindowBusy(MEET, true);
    const replace = fakeFrame(MEET);

    openMenuWindow(PARAMS);

    expect(replace).not.toHaveBeenCalled();
    expect(useWindowStore.getState().nav[MEET]).toHaveLength(2);
    expect(toastWarning).toHaveBeenCalledTimes(1);
  });

  it("🔴 미저장 창은 첫 화면으로 옮기되(떠나기 확인이 글을 지킨다) 기록은 새 문서가 뜰 때 바꾼다", () => {
    openAtRoot();
    drillIn();
    useWindowStore.getState().setWindowDirty(MEET, true);
    const replace = fakeFrame(MEET);

    openMenuWindow(PARAMS);

    expect(replace).toHaveBeenCalledWith("/meetings?embed=1");
    expect(useWindowStore.getState().nav[MEET]).toHaveLength(2); // '머무르기'면 이대로가 맞다
    // '떠나기' — 새 문서의 첫 로드 보고(RouteWindow onLoad)에서만 기록이 바뀐다
    useWindowStore.getState().observeIframe(MEET, { title: "회의록", url: "/meetings?embed=1", load: true });
    expect(useWindowStore.getState().nav[MEET]).toEqual(["/meetings?embed=1"]);
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

  it("🔴 창 크롬(← 뒤로·메뉴의 첫 화면)은 iframe 주소를 직접 바꾸지 않는다 — navigateWindow(늘 embed=1)만", () => {
    // 전수검사 2026-09-11: ←만 기록 주소를 그대로 열어 창 안에 풀 셸이 떴다(메뉴 재클릭은 withEmbed를 붙였다).
    for (const p of ["components/workspace/floating-window.tsx", "components/workspace/open-menu-window.ts"]) {
      const src = read(p);
      expect(src, p).not.toContain("location.replace(");
      expect(src, p).toContain("navigateWindow(");
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
