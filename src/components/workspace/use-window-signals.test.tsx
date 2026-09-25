import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

import { publishMutation } from "@/lib/realtime/mutation-signal";
import { RouteWindow } from "./route-window";
import { hasPainted, isWindowHidden, mayTakeFocus, SLOW_LOAD_MS, STALE_AFTER_MS } from "./window-signals-core";
import { WINDOW_REFRESH_MESSAGE } from "./window-bridge";
import { useWindowStore, windowId, type Win } from "./window-store";

const ID = windowId("route", "students");
const OTHER = windowId("route", "classes");

function makeWin(id = ID, over: Partial<Win> = {}): Win {
  return {
    id,
    kind: "route",
    params: { id: id.slice(6), title: "원생", href: "/students" },
    rect: { x: 0, y: 0, w: 800, h: 600 },
    minimized: false,
    maximized: false,
    ...over,
  };
}

describe("isWindowHidden — 눈에 안 보이는 창", () => {
  const base = { spotlight: false, spotlightRaised: [] as string[] };
  it("최소화·보관(minimized)·없는 창은 숨음", () => {
    expect(isWindowHidden({ ...base, windows: { [ID]: makeWin(ID, { minimized: true }) }, order: [] }, ID)).toBe(true);
    expect(isWindowHidden({ ...base, windows: {}, order: [] }, ID)).toBe(true);
  });
  it("🔴 최대화 창 **뒤**에 있으면 숨음, 앞에 있으면 보임", () => {
    const windows = { [ID]: makeWin(ID), [OTHER]: makeWin(OTHER, { maximized: true }) };
    expect(isWindowHidden({ ...base, windows, order: [ID, OTHER] }, ID)).toBe(true);
    expect(isWindowHidden({ ...base, windows, order: [OTHER, ID] }, ID)).toBe(false);
    expect(isWindowHidden({ ...base, windows, order: [ID, OTHER] }, OTHER)).toBe(false);
  });
  it("최소화된 최대화 창은 아무것도 가리지 않는다", () => {
    const windows = { [ID]: makeWin(ID), [OTHER]: makeWin(OTHER, { maximized: true, minimized: true }) };
    expect(isWindowHidden({ ...base, windows, order: [ID, OTHER] }, ID)).toBe(false);
  });
  it("앨범(스포트라이트)에선 위로 올라온 창만 보임 — 최대화 여부는 안 본다", () => {
    const windows = { [ID]: makeWin(ID), [OTHER]: makeWin(OTHER, { maximized: true }) };
    const s = { windows, order: [ID, OTHER], spotlight: true, spotlightRaised: [ID] };
    expect(isWindowHidden(s, ID)).toBe(false);
    expect(isWindowHidden(s, OTHER)).toBe(true);
  });
});

describe("hasPainted — 새 문서가 첫 화면을 그렸나", () => {
  const withMain = () => {
    const d = document.implementation.createHTMLDocument("x");
    const m = d.createElement("main");
    m.className = "embed-main";
    d.body.appendChild(m);
    return d;
  };
  it("창용 셸 본문이 도착한 새 문서면 true", () => {
    expect(hasPainted(withMain(), null)).toBe(true);
  });
  it("본문이 아직 없으면 false · 문서가 없으면 false", () => {
    expect(hasPainted(document.implementation.createHTMLDocument("x"), null)).toBe(false);
    expect(hasPainted(null, null)).toBe(false);
  });
  it("🔴 마지막으로 보여 준 문서는 본문이 있어도(아직 로딩 중이어도) false — ⟳ 직후 옛 화면을 새 화면으로 오인하지 않는다", () => {
    const old = withMain();
    Object.defineProperty(old, "readyState", { value: "interactive" }); // 이미지·폰트를 아직 받는 중
    expect(hasPainted(old, old)).toBe(false);
    expect(hasPainted(withMain(), old)).toBe(true);
  });
});

/** 창 iframe의 문서를 바꿔 끼울 수 있는 가짜 — 부모가 보는 건 contentWindow·contentDocument뿐. */
function mountFrame(container: HTMLElement) {
  const iframe = container.querySelector("iframe")!;
  const postMessage = vi.fn();
  const replace = vi.fn();
  const makeDoc = (painted: boolean) => {
    const d = document.implementation.createHTMLDocument("원생 — aywa");
    if (painted) {
      const m = d.createElement("main");
      m.className = "embed-main";
      d.body.appendChild(m);
    }
    return d;
  };
  const state = { doc: makeDoc(false) };
  const cw = {
    location: { href: "http://localhost/students?embed=1", pathname: "/students", search: "?embed=1", hash: "", replace, reload: vi.fn() },
    addEventListener: () => {},
    removeEventListener: () => {},
    postMessage,
    HTMLIFrameElement: window.HTMLIFrameElement,
    document: { activeElement: null, body: null },
    Document: window.Document,
    Event: window.Event,
  };
  Object.defineProperty(iframe, "contentWindow", { configurable: true, get: () => cw });
  Object.defineProperty(iframe, "contentDocument", { configurable: true, get: () => state.doc });
  return {
    iframe,
    postMessage,
    replace,
    paint: () => {
      state.doc = makeDoc(true);
    },
    get doc() {
      return state.doc;
    },
  };
}

const skeleton = (c: HTMLElement) => c.querySelector(".animate-pulse");

beforeEach(() => {
  vi.useFakeTimers();
  useWindowStore.setState({
    windows: { [ID]: makeWin(), [OTHER]: makeWin(OTHER) },
    order: [OTHER, ID],
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
afterEach(() => {
  vi.useRealTimers();
});

function renderWindow() {
  const utils = render(<RouteWindow win={useWindowStore.getState().windows[ID]!} />);
  const rerenderFromStore = () => utils.rerender(<RouteWindow win={useWindowStore.getState().windows[ID]!} />);
  return { ...utils, rerenderFromStore };
}

describe("RouteWindow — 첫 페인트에서 스켈레톤을 걷는다", () => {
  it("🔴 load를 기다리지 않고, 창용 본문이 도착한 프레임에 걷는다(창 안 loading.tsx·먼저 온 본문이 보이게)", () => {
    const { container } = renderWindow();
    const f = mountFrame(container);
    act(() => vi.advanceTimersByTime(50));
    expect(skeleton(container)).not.toBeNull(); // 아직 본문 없음
    f.paint();
    act(() => vi.advanceTimersByTime(50));
    expect(skeleton(container)).toBeNull(); // load 없이 걷혔다
  });
});

describe("RouteWindow — 숨김을 창 문서에 싣는다", () => {
  it("🔴 최소화하면 창 문서가 hidden을 답한다(폴링이 멈춘다) · 복원하면 visible", () => {
    const { container, rerenderFromStore } = renderWindow();
    const f = mountFrame(container);
    f.paint();
    act(() => vi.advanceTimersByTime(50));
    expect(f.doc.visibilityState).toBe("visible");

    act(() => useWindowStore.getState().minimize(ID));
    rerenderFromStore();
    expect(f.doc.visibilityState).toBe("hidden");

    act(() => useWindowStore.getState().restore(ID));
    rerenderFromStore();
    expect(f.doc.visibilityState).toBe("visible");
  });

  it("최대화 창이 위를 덮으면 hidden", () => {
    const { container } = renderWindow();
    const f = mountFrame(container);
    f.paint();
    act(() => vi.advanceTimersByTime(50));
    act(() => {
      useWindowStore.getState().focus(OTHER);
      useWindowStore.getState().toggleMax(OTHER);
    });
    expect(f.doc.visibilityState).toBe("hidden");
  });
});

describe("RouteWindow — 숨어 있던 사이 바뀐 창은 다시 보일 때 소프트 새로고침", () => {
  function setup() {
    const r = renderWindow();
    const f = mountFrame(r.container);
    f.paint();
    act(() => vi.advanceTimersByTime(50));
    return { ...r, f };
  }
  const refreshCalls = (f: ReturnType<typeof mountFrame>) =>
    f.postMessage.mock.calls.filter(([m]) => (m as { type?: string })?.type === WINDOW_REFRESH_MESSAGE).length;

  it("🔴 숨어 있는 동안 다른 곳에서 저장 → 다시 보이면 한 번 새로고침", () => {
    const { f, rerenderFromStore } = setup();
    act(() => useWindowStore.getState().minimize(ID));
    rerenderFromStore();
    act(() => publishMutation());
    act(() => useWindowStore.getState().restore(ID));
    rerenderFromStore();
    act(() => vi.advanceTimersByTime(200));
    expect(refreshCalls(f)).toBe(1);

    // 한 번 새로고침했으면 다음 복원엔 안 한다(바뀐 게 없다).
    act(() => useWindowStore.getState().minimize(ID));
    rerenderFromStore();
    act(() => useWindowStore.getState().restore(ID));
    rerenderFromStore();
    act(() => vi.advanceTimersByTime(200));
    expect(refreshCalls(f)).toBe(1);
  });

  it("보이는 동안의 저장은 안 센다 · 바뀐 게 없으면 복원해도 새로고침 없음", () => {
    const { f, rerenderFromStore } = setup();
    act(() => publishMutation()); // 보이는 중
    act(() => useWindowStore.getState().minimize(ID));
    rerenderFromStore();
    act(() => useWindowStore.getState().restore(ID));
    rerenderFromStore();
    act(() => vi.advanceTimersByTime(200));
    expect(refreshCalls(f)).toBe(0);
  });

  it("🔴 미저장 창은 새로고침하지 않는다(입력 보호)", () => {
    const { f, rerenderFromStore } = setup();
    act(() => useWindowStore.getState().setWindowDirty(ID, true));
    act(() => useWindowStore.getState().minimize(ID));
    rerenderFromStore();
    act(() => publishMutation());
    act(() => useWindowStore.getState().restore(ID));
    rerenderFromStore();
    act(() => vi.advanceTimersByTime(200));
    expect(refreshCalls(f)).toBe(0);
  });

  it("신호가 없어도 오래(10분+) 숨어 있던 창은 새로고침한다(다른 직원의 변경)", () => {
    const { f, rerenderFromStore } = setup();
    act(() => useWindowStore.getState().minimize(ID));
    rerenderFromStore();
    act(() => vi.advanceTimersByTime(STALE_AFTER_MS + 1000));
    act(() => useWindowStore.getState().restore(ID));
    rerenderFromStore();
    act(() => vi.advanceTimersByTime(200));
    expect(refreshCalls(f)).toBe(1);
  });
});

describe("RouteWindow — 느린 첫 화면엔 '다시 시도'", () => {
  it("🔴 12초가 지나도 안 그려지면 안내 + 다시 시도가 그 창만 다시 부른다", () => {
    const { container, getByText } = renderWindow();
    const f = mountFrame(container);
    act(() => vi.advanceTimersByTime(SLOW_LOAD_MS - 100));
    expect(container.textContent).not.toContain("다시 시도");
    act(() => vi.advanceTimersByTime(200));
    fireEvent.click(getByText("다시 시도"));
    expect(f.replace).toHaveBeenCalledWith("/students?embed=1");
    expect(container.textContent).not.toContain("다시 시도"); // 다시 12초를 기다린다
  });

  it("제때 그려지면 안내가 안 뜬다", () => {
    const { container } = renderWindow();
    const f = mountFrame(container);
    f.paint();
    act(() => vi.advanceTimersByTime(SLOW_LOAD_MS * 2));
    expect(container.textContent).not.toContain("다시 시도");
  });
});

describe("mayTakeFocus — 키보드 초점을 옮겨도 되나", () => {
  function setup() {
    const win = document.createElement("div");
    win.setAttribute("data-window-id", ID);
    const chrome = document.createElement("button");
    const frame = document.createElement("iframe");
    win.append(chrome, frame);
    document.body.append(win);
    return { win, chrome, frame };
  }
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("아무 데도 초점이 없거나(body) 사이드바 링크에 있으면 옮긴다", () => {
    const { frame } = setup();
    expect(mayTakeFocus(document.body, frame, document.body)).toBe(true);
    const link = document.createElement("a");
    document.body.append(link);
    expect(mayTakeFocus(link, frame, document.body)).toBe(true);
  });

  it("🔴 입력 중인 칸·이 창의 틀(닫기·Esc)·열린 메뉴에선 뺏지 않는다", () => {
    const { frame, chrome } = setup();
    const input = document.createElement("input");
    document.body.append(input);
    expect(mayTakeFocus(input, frame, document.body)).toBe(false);
    expect(mayTakeFocus(chrome, frame, document.body)).toBe(false);
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    const item = document.createElement("button");
    menu.append(item);
    document.body.append(menu);
    expect(mayTakeFocus(item, frame, document.body)).toBe(false);
  });

  it("🔴 다른 창 iframe 안에서 입력 중이면 뺏지 않는다 — 그냥 머물러 있으면 옮긴다", () => {
    const { frame } = setup();
    const other = document.createElement("iframe");
    document.body.append(other);
    const typing = { activeElement: document.createElement("textarea") };
    Object.defineProperty(other, "contentDocument", { configurable: true, get: () => typing });
    expect(mayTakeFocus(other, frame, document.body)).toBe(false);
    const idle = { activeElement: document.createElement("div") };
    Object.defineProperty(other, "contentDocument", { configurable: true, get: () => idle });
    expect(mayTakeFocus(other, frame, document.body)).toBe(true);
  });
});

describe("미저장 표식 — 새 문서당 한 번만 내린다", () => {
  it("🔴 첫 페인트 뒤 입력으로 올라온 표식을 load가 지우지 않는다(닫기가 확인 없이 닫히던 것)", () => {
    const { container } = renderWindow();
    const f = mountFrame(container);
    f.paint();
    act(() => vi.advanceTimersByTime(50)); // 첫 페인트 — 옛 표식 정리
    act(() => useWindowStore.getState().setWindowDirty(ID, true)); // load 전에 입력 시작
    act(() => {
      fireEvent.load(f.iframe);
    });
    expect(useWindowStore.getState().dirty[ID]).toBe(true);
  });
});
