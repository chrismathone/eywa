import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KeepaliveStage } from "./keepalive-stage";
import { KeepaliveFrameProvider } from "./shell-mode";
import { EmbedProvider } from "./embed-context";
import { BackLink } from "@/components/back-link";
import { KeepalivePageMaximize } from "@/components/page-maximize/keepalive-page-maximize";
import { PageMaximizeButton } from "@/components/page-maximize/page-maximize-button";
import { PAGE_MAXIMIZE_SET_MESSAGE, PAGE_MAXIMIZE_STATE_MESSAGE } from "./keepalive-frame";
import { useWindowStore, windowId } from "./window-store";

vi.mock("sonner", () => ({ toast: { warning: vi.fn(), info: vi.fn() } }));
// 창 본문(RouteWindow — iframe·스토어 구독)은 이 테스트의 관심이 아니다 — 무대의 감싸기만 본다.
vi.mock("./window-content", () => ({
  WindowContent: ({ win }: { win: { id: string } }) => <div data-testid={`content-${win.id}`} />,
}));

describe("KeepaliveStage — 한 화면만 보이고 나머지는 보이지 않게 둔다", () => {
  beforeEach(() => {
    useWindowStore.setState({ windows: {}, order: [], focusedId: null });
  });

  it("숨은 화면은 invisible(visibility:hidden) + 클릭 불가, 보이는 화면은 그대로 — 둘 다 마운트돼 있다(문서·스크롤 보존)", () => {
    const s = useWindowStore.getState();
    s.open("route", { id: "students", title: "원생", href: "/students" });
    s.open("route", { id: "classes", title: "수업", href: "/classes" });
    useWindowStore.getState().minimize(windowId("route", "students"));
    useWindowStore.setState((st) => ({ focusedId: windowId("route", "classes"), windows: st.windows }));

    const { container } = render(<KeepaliveStage />);
    const frames = container.querySelectorAll<HTMLElement>("[data-window-id]");
    expect(frames).toHaveLength(2);
    const byId = Object.fromEntries([...frames].map((f) => [f.dataset.windowId, f]));
    const hidden = byId[windowId("route", "students")];
    const shown = byId[windowId("route", "classes")];
    expect(hidden.className).toContain("invisible");
    expect(hidden.className).toContain("pointer-events-none");
    expect(hidden.className).not.toMatch(/(^|\s)hidden(\s|$)/); // display:none 아님(#131)
    expect(hidden.getAttribute("aria-hidden")).toBe("true");
    expect(shown.className).not.toContain("invisible");
    expect(shown.className).toContain("pointer-events-auto");
    expect(screen.getByTestId(`content-${windowId("route", "students")}`)).toBeTruthy(); // 숨어도 언마운트되지 않는다
  });
});

describe("BackLink — 창 크롬이 없는 이전 화면 유지 화면에선 서야 한다", () => {
  it("일반 창(embed)에서는 숨는다(종전 그대로)", () => {
    const { container } = render(
      <EmbedProvider embed>
        <BackLink href="/students" label="← 목록" />
      </EmbedProvider>,
    );
    expect(container.textContent).toBe("");
  });

  it("이전 화면 유지 화면(embed + 창 크롬 없음 표식)에서는 보인다", () => {
    render(
      <EmbedProvider embed>
        <KeepaliveFrameProvider>
          <BackLink href="/students" label="← 목록" />
        </KeepaliveFrameProvider>
      </EmbedProvider>,
    );
    expect(screen.getByText("← 목록")).toBeTruthy();
  });
});

describe("KeepalivePageMaximize — 부모 셸과 상태를 맞춘다", () => {
  const post = vi.fn();
  const fakeParent = { postMessage: post } as unknown as Window;

  beforeEach(() => {
    post.mockClear();
    vi.spyOn(window, "parent", "get").mockReturnValue(fakeParent);
  });
  afterEach(() => vi.restoreAllMocks());

  function fromParent(data: unknown, source: unknown = fakeParent, origin = window.location.origin) {
    const e = new MessageEvent("message", { data, origin });
    Object.defineProperty(e, "source", { value: source });
    act(() => {
      window.dispatchEvent(e);
    });
  }
  const marker = (c: HTMLElement) => c.querySelector("[data-page-maximize]")!.getAttribute("data-page-maximize");

  it("서버가 준 초기값으로 시작하고, 열릴 때 부모에게 지금 상태를 묻는다", () => {
    const { container } = render(
      <KeepalivePageMaximize initial={true}>
        <i />
      </KeepalivePageMaximize>,
    );
    expect(marker(container)).toBe("on");
    expect(post).toHaveBeenCalledWith({ type: "eywa-page-maximize-query" }, window.location.origin);
  });

  it("부모가 알려 주는 상태를 따라간다 — 부모 창·같은 출처에서 온 것만", () => {
    const { container } = render(
      <KeepalivePageMaximize initial={false}>
        <i />
      </KeepalivePageMaximize>,
    );
    fromParent({ type: PAGE_MAXIMIZE_STATE_MESSAGE, on: true });
    expect(marker(container)).toBe("on");
    fromParent({ type: PAGE_MAXIMIZE_STATE_MESSAGE, on: false }, { other: true }); // 다른 창 — 무시
    expect(marker(container)).toBe("on");
    fromParent({ type: PAGE_MAXIMIZE_STATE_MESSAGE, on: false }, fakeParent, "https://evil.example"); // 다른 출처 — 무시
    expect(marker(container)).toBe("on");
    fromParent({ type: PAGE_MAXIMIZE_STATE_MESSAGE, on: false });
    expect(marker(container)).toBe("off");
  });

  it("화면의 '화면 최대화' 버튼은 부모에게 눌림을 알리고 바로 보이게 한다 — 이전 화면 유지 화면에선 iframe 안에서도 선다", () => {
    vi.spyOn(window, "top", "get").mockReturnValue(fakeParent); // self !== top → 물리적 iframe 안
    const { container } = render(
      <KeepaliveFrameProvider>
        <KeepalivePageMaximize initial={false}>
          <PageMaximizeButton />
        </KeepalivePageMaximize>
      </KeepaliveFrameProvider>,
    );
    const btn = container.querySelector<HTMLButtonElement>("[data-page-maximize-button]");
    expect(btn, "iframe 안(useInFrame=true)에서도 버튼이 선다").not.toBeNull();
    act(() => btn!.click());
    expect(post).toHaveBeenCalledWith({ type: PAGE_MAXIMIZE_SET_MESSAGE, on: true }, window.location.origin);
    expect(marker(container)).toBe("on");
  });
});
