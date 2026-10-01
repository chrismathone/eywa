import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWindowStore, windowId } from "./window-store";
import { useKeepaliveFollow } from "./use-keepalive-follow";
import { iframeRegistry } from "./route-window";

const { replace, push, rendered } = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  // 바탕(<main>)이 실제로 그리고 있는 세그먼트(라우터 트리) — 주소만 바꾸는 이동(pushState)으로는 안 바뀐다.
  rendered: { segments: ["dashboard"] as string[] },
}));
vi.mock("next/navigation", () => ({
  usePathname: () => window.location.pathname,
  useRouter: () => ({ replace, push, refresh: vi.fn() }),
  useSelectedLayoutSegments: () => rendered.segments,
}));
vi.mock("sonner", () => ({ toast: { warning: vi.fn(), info: vi.fn() } }));

const HOME = "/dashboard";
const id = (menu: string) => windowId("route", menu);
const st = () => useWindowStore.getState();
const here = () => window.location.pathname + window.location.search;
const visible = () =>
  Object.values(st().windows)
    .filter((w) => !w.minimized)
    .map((w) => w.id);

function resetStore() {
  useWindowStore.setState({
    owner: null,
    shellMode: "keepalive",
    lastUsed: {},
    kaVisible: null,
    kaBack: null,
    windows: {},
    order: [],
    focusedId: null,
    live: {},
    nav: {},
    dirty: {},
    busy: {},
    pendingNav: {},
    homeNonce: {},
    cached: [],
    spotlight: false,
    spotlightRaised: [],
  });
}

/** 주소를 열고 훅을 붙인다 — 문서로 연 주소는 바탕도 그 화면을 그린다(딥링크 = 서버가 그 화면을 렌더). */
function mount(url: string) {
  window.history.replaceState(null, "", url);
  rendered.segments = url.split("?")[0].split("/").filter(Boolean);
  return renderHook(() => useKeepaliveFollow(true, HOME));
}

describe("useKeepaliveFollow — 주소창은 보이는 화면을 따라간다", () => {
  beforeEach(() => {
    resetStore();
    replace.mockClear();
    push.mockClear();
    rendered.segments = ["dashboard"];
    document.title = "운영실 — 에이와";
  });
  afterEach(() => {
    vi.useRealTimers();
    window.history.replaceState(null, "", "/");
  });

  it("주소를 직접 열어 들어오면(딥링크·새로고침) 그 화면이 열린다 — 주소는 그대로", () => {
    mount("/students?tab=a");
    expect(visible()).toEqual([id("students")]);
    expect(st().windows[id("students")].params.href).toBe("/students?tab=a");
    expect(here()).toBe("/students?tab=a");
  });

  it("첫 화면 주소로 들어오면 아무 화면도 열지 않는다(바탕이 보인다)", () => {
    mount(HOME);
    expect(Object.keys(st().windows)).toEqual([]);
    expect(replace).not.toHaveBeenCalled();
  });

  it("메뉴로 다른 화면을 열면 주소가 따라가고(기록 한 칸 추가) 이전 화면은 숨는다", () => {
    mount("/students");
    const before = window.history.length;
    act(() => {
      st().open("route", { id: "classes", title: "수업", href: "/classes" });
    });
    expect(here()).toBe("/classes");
    expect(window.history.length).toBe(before + 1);
    expect(visible()).toEqual([id("classes")]);
    expect(st().windows[id("students")].minimized).toBe(true);
  });

  it("같은 화면 안 이동(드릴인)은 기록을 늘리지 않고 주소만 바꾼다(replace)", () => {
    mount("/students");
    const before = window.history.length;
    act(() => {
      st().observeIframe(id("students"), { title: "원생", url: "/students/abc?embed=1", load: true });
    });
    expect(here()).toBe("/students/abc"); // embed=1은 주소창에 안 나온다
    expect(window.history.length).toBe(before);
  });

  it("뒤로가기 = 이전 화면 — 숨은 화면이 그대로 돌아온다(새 항목을 만들지 않는다)", async () => {
    mount("/students");
    act(() => {
      st().open("route", { id: "classes", title: "수업", href: "/classes" });
    });
    const before = window.history.length;
    act(() => window.history.back());
    await waitFor(() => expect(here()).toBe("/students"));
    await waitFor(() => expect(visible()).toEqual([id("students")]));
    expect(Object.keys(st().windows)).toHaveLength(2); // 닫히지 않았다
    expect(window.history.length).toBe(before); // 되돌아가며 기록이 늘지 않는다
    // 앞으로
    act(() => window.history.forward());
    await waitFor(() => expect(visible()).toEqual([id("classes")]));
  });

  it("'오늘'(전부 숨김)이면 주소가 첫 화면이 되고, 뒤로가면 마지막 화면이 돌아온다", async () => {
    mount(HOME);
    act(() => {
      st().open("route", { id: "students", title: "원생", href: "/students" });
    });
    expect(here()).toBe("/students");
    act(() => st().showDesktop());
    expect(here()).toBe(HOME);
    expect(push).not.toHaveBeenCalled(); // 바탕이 이미 첫 화면 — 주소만 바꾼다(서버 요청 없음)
    expect(visible()).toEqual([]);
    act(() => window.history.back());
    await waitFor(() => expect(visible()).toEqual([id("students")]));
  });

  it("뒤로가기로 돌아온 화면의 iframe이 이미 그 주소면 다시 불러오지 않는다(href 이동 없음)", async () => {
    mount("/students");
    act(() => {
      st().open("route", { id: "classes", title: "수업", href: "/classes" });
    });
    const hrefBefore = st().windows[id("students")].params.href;
    act(() => window.history.back());
    await waitFor(() => expect(visible()).toEqual([id("students")]));
    expect(st().windows[id("students")].params.href).toBe(hrefBefore);
  });

  it("🔴 드릴인한 화면에서 다른 화면을 거쳐 뒤로가기 — 보관해 둔 그 화면이 돌아온다(새 화면이 열리지 않는다)", async () => {
    mount("/students");
    act(() => {
      st().observeIframe(id("students"), { title: "원생", url: "/students/abc?embed=1", load: true });
    });
    expect(here()).toBe("/students/abc");
    act(() => {
      st().open("route", { id: "classes", title: "수업", href: "/classes" });
    });
    act(() => window.history.back());
    await waitFor(() => expect(visible()).toEqual([id("students")]));
    expect(Object.keys(st().windows).sort()).toEqual([id("classes"), id("students")].sort()); // students/abc 창이 새로 생기지 않았다
    expect(st().windows[id("students")].params.href).toBe("/students"); // 이동(재로딩) 없음
  });

  it("🔴 메뉴 화면이 있어도 하위 주소(상세)는 다른 입구와 같은 id의 화면으로 연다 — 숨겨 둔 목록(필터·스크롤)을 옮겨 날리지 않는다", () => {
    useWindowStore.setState({
      windows: {
        [id("students")]: {
          id: id("students"),
          kind: "route",
          params: { id: "students", title: "원생", href: "/students" },
          rect: { x: 0, y: 0, w: 1, h: 1 },
          minimized: true,
          maximized: false,
        },
      },
      order: [id("students")],
      focusedId: null,
      lastUsed: { [id("students")]: Date.now() },
    });
    mount("/students/abc");
    expect(Object.keys(st().windows).sort()).toEqual([id("students"), id("students/abc")].sort());
    expect(st().windows[id("students")].params.href).toBe("/students"); // 목록 화면은 그대로
    expect(visible()).toEqual([id("students/abc")]);
  });

  it("🔴 입력 중인 화면은 뒤로가기로 옮기지 않는다 — 보이게만 한다(옮기면 iframe이 다시 불려 입력이 사라진다)", async () => {
    mount("/students");
    act(() => {
      st().open("route", { id: "classes", title: "수업", href: "/classes" });
    });
    // 숨은 동안 students가 스스로 다른 주소로 가 있고 입력 중이다
    act(() => {
      st().observeIframe(id("students"), { title: "원생", url: "/students/zzz?embed=1", load: true });
      st().setWindowDirty(id("students"), true);
    });
    const pushed = vi.spyOn(window.history, "pushState");
    act(() => window.history.back());
    await waitFor(() => expect(visible()).toEqual([id("students")]));
    expect(st().windows[id("students")].params.href).toBe("/students"); // 옮기지 않았다
    expect(st().dirty[id("students")]).toBe(true);
    // 🔴 주소에서 출발한 동기화는 기록을 쌓지 않는다(replace) — 주소는 그 화면의 실제 주소로 맞추되 앞으로 가기 기록이 산다.
    //    (happy-dom의 replaceState는 앞 기록을 잘라 버려 실제 브라우저와 달라서 '앞으로'는 여기서 못 잰다 — push가 없었음을 본다.)
    expect(here()).toBe("/students/zzz");
    expect(pushed).not.toHaveBeenCalled();
    pushed.mockRestore();
  });

  it("폭이 좁아져 이 방식이 꺼지면 본문이 그 주소의 화면을 그리게 한다", () => {
    window.history.replaceState(null, "", HOME);
    const { rerender } = renderHook(({ on }) => useKeepaliveFollow(on, HOME), { initialProps: { on: true } });
    act(() => {
      st().open("route", { id: "students", title: "원생", href: "/students" });
    });
    expect(here()).toBe("/students");
    replace.mockClear();
    rerender({ on: false });
    expect(replace).toHaveBeenCalledWith("/students", { scroll: false });
  });

  it("좁아질 때 주소도 바탕도 첫 화면이면 아무것도 다시 받지 않는다", () => {
    window.history.replaceState(null, "", HOME);
    const { rerender } = renderHook(({ on }) => useKeepaliveFollow(on, HOME), { initialProps: { on: true } });
    rerender({ on: false });
    expect(replace).not.toHaveBeenCalled();
  });

  it("라우터가 주소를 바꾸면(맨 Link 이동) 그 화면을 연다", () => {
    const { rerender } = mount(HOME);
    act(() => {
      window.history.pushState(null, "", "/classes");
    });
    rerender();
    expect(visible()).toEqual([id("classes")]);
  });

  it("딥링크로 들어오면 바탕은 미리 옮기지 않는다 — 첫 화면으로 갈 때만 라우터로 첫 화면을 연다(바탕이 그 화면을 그리고 있다)", () => {
    vi.useFakeTimers();
    mount("/students");
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(replace).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled(); // 첫 화면을 안 볼 사람에게 운영실 렌더 비용을 치르게 하지 않는다
    act(() => st().showDesktop());
    expect(push).toHaveBeenCalledWith(HOME, { scroll: false });
    expect(here()).toBe("/students"); // 주소는 라우터가 이동을 마칠 때 바뀐다(우리가 따로 쓰지 않는다)
  });

  it("🔴 바탕에서 재렌더(refresh·재검증)가 돌아 바탕이 보이던 화면을 그리고 있으면 첫 화면으로 갈 때 라우터로 다시 받는다", () => {
    const { rerender } = mount(HOME);
    act(() => {
      st().open("route", { id: "classes", title: "수업", href: "/classes" });
    });
    rendered.segments = ["classes"]; // 그 주소로 refresh가 돌았다
    rerender();
    act(() => st().showDesktop());
    expect(push).toHaveBeenCalledWith(HOME, { scroll: false });
  });

  it("라우터가 첫 화면 이동을 마치면(주소 = 첫 화면) 다시 화면을 열지 않는다", () => {
    const { rerender } = mount("/students");
    act(() => st().showDesktop());
    act(() => {
      window.history.pushState(null, "", HOME);
    });
    rendered.segments = ["dashboard"];
    rerender();
    expect(visible()).toEqual([]);
    expect(Object.keys(st().windows)).toEqual([id("students")]); // 숨어서 남아 있다
  });

  it("탭 제목은 보이는 화면의 제목을 따르고, 첫 화면으로 돌아오면 바탕 제목으로 되돌린다", () => {
    mount(HOME);
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    frame.contentDocument!.title = "수업 목록 — 에이와";
    act(() => {
      st().open("route", { id: "classes", title: "수업", href: "/classes" });
    });
    iframeRegistry.set(id("classes"), frame);
    act(() => {
      st().observeIframe(id("classes"), { title: "수업 목록", url: "/classes?embed=1", load: true });
    });
    expect(document.title).toBe("수업 목록 — 에이와");
    act(() => st().showDesktop());
    expect(document.title).toBe("운영실 — 에이와");
    iframeRegistry.delete(id("classes"));
    frame.remove();
  });

  it("복원된 영속본이 2시간 지난 것이면 시작할 때 비우고 첫 화면부터 — 주소가 같은 화면이면 새로 연다", () => {
    const old = Date.now() - 3 * 60 * 60 * 1000;
    useWindowStore.setState({
      windows: {
        [id("classes")]: {
          id: id("classes"),
          kind: "route",
          params: { id: "classes", title: "수업", href: "/classes" },
          rect: { x: 0, y: 0, w: 1, h: 1 },
          minimized: false,
          maximized: false,
        },
      },
      order: [id("classes")],
      focusedId: id("classes"),
      lastUsed: { [id("classes")]: old },
    });
    mount("/classes");
    // 옛 기억은 지워지고, 주소(URL)가 가리키는 화면은 새로 열린다(=북마크·새로고침은 늘 동작한다)
    expect(visible()).toEqual([id("classes")]);
    expect(st().lastUsed[id("classes")]).toBeGreaterThan(old);
  });

  it("끄면(active=false) 아무것도 하지 않는다 — 창 모드·단일 화면 지점에는 닿지 않는다", () => {
    window.history.replaceState(null, "", "/students");
    renderHook(() => useKeepaliveFollow(false, HOME));
    expect(Object.keys(st().windows)).toEqual([]);
  });
});
