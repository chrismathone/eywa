import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { usePrefs } from "./use-prefs";
import { useWindowStore, windowId } from "./window-store";
import { WindowSwitcher } from "./window-switcher";

// 독의 닫기는 창 자체 X와 같은 경로(useCloseWindow)를 타므로 배경 새로고침(router.refresh)이 딸려온다.
const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const { toastInfo, toastWarning } = vi.hoisted(() => ({ toastInfo: vi.fn(), toastWarning: vi.fn() }));
vi.mock("sonner", () => ({ toast: { info: toastInfo, warning: toastWarning } }));

/** 스토어 런타임 상태 초기화(테스트 간 누수 방지). */
function resetStore() {
  useWindowStore.setState({
    windows: {},
    order: [],
    focusedId: null,
    cached: [],
    live: {},
    nav: {},
    reloadNonce: {},
    dirty: {},
    busy: {},
    spotlight: false,
    spotlightRaised: [],
  });
  usePrefs.setState({ dockCollapsed: false });
}

/**
 * 독(하단 왼쪽 창 전환기)은 **자동 숨김**이라 평소엔 작은 핸들만 보인다. 그런데 최소화한 창은
 * 화면에서 통째로 사라지고(사이드바 점도 비최소화 창만 표시) 독이 되살릴 유일한 경로다 —
 * 그 상태에서까지 독이 숨으면 창이 갇힌다(원장 제보 2026-07-31 "아무것도 안 보이네").
 * 여기서 잠그는 계약: **최소화한 창이 있으면 호버 없이도 칩이 보인다.**
 */
describe("WindowSwitcher — 최소화한 창이 있으면 독을 고정 노출", () => {
  beforeEach(resetStore);

  it("창 하나를 최소화하면 호버 전에도 그 창 칩이 보인다", () => {
    const st = useWindowStore.getState();
    st.open("route", { id: "students", title: "학생목록", href: "/students" });
    st.minimize(windowId("route", "students"));

    render(<WindowSwitcher />);

    expect(screen.getByText("학생목록")).toBeTruthy();
  });

  it("전부 열려 있으면 평소대로 숨는다(핸들만) — 본문을 가리지 않는다", () => {
    const st = useWindowStore.getState();
    st.open("route", { id: "students", title: "학생목록", href: "/students" });
    st.open("route", { id: "classes", title: "수업목록", href: "/classes" });

    render(<WindowSwitcher />);

    expect(screen.queryByText("학생목록")).toBeNull();
    expect(screen.queryByText("수업목록")).toBeNull();
  });

  it("창이 1개뿐이고 그게 열려 있으면 독 자체를 렌더하지 않는다", () => {
    useWindowStore
      .getState()
      .open("route", { id: "students", title: "학생목록", href: "/students" });

    const { container } = render(<WindowSwitcher />);

    expect(container.firstChild).toBeNull();
  });
});

/**
 * 자리·접기 계약(원장 제보 2026-08-04 "저장버튼하고 겹쳐서 누르는데 애로사항이 있다").
 * 폼 저장 바(FormActionBar)는 규약상 창 하단 **우측 정렬**이라 하단 오른쪽은 저장/취소 버튼의 자리다.
 * 하단 중앙은 목록 페이지네이션(07-30에 그래서 오른쪽으로 옮겼다) → 남는 자리는 하단 **왼쪽**뿐.
 * 그래도 겹치는 화면이 나오면 사용자가 접을 수 있어야 하고, **접어도 최소화 창은 되살릴 수 있어야 한다.**
 */
describe("WindowSwitcher — 하단 왼쪽 + 접기/펼치기", () => {
  beforeEach(resetStore);

  it("독은 하단 **왼쪽**에 붙는다 — 우측 정렬 저장 버튼과 겹치지 않게", () => {
    const st = useWindowStore.getState();
    st.open("route", { id: "students", title: "학생목록", href: "/students" });
    st.minimize(windowId("route", "students"));

    const { container } = render(<WindowSwitcher />);
    const root = container.firstChild as HTMLElement;

    expect(root.className).toContain("left-2");
    expect(root.className).not.toContain("right-2");
  });

  it("접으면 최소화 창이 있어도 칩이 숨고, 최소화 개수를 띄운 펼치기 버튼만 남는다", () => {
    const st = useWindowStore.getState();
    st.open("route", { id: "students", title: "학생목록", href: "/students" });
    st.open("route", { id: "classes", title: "수업목록", href: "/classes" });
    st.minimize(windowId("route", "students"));
    usePrefs.setState({ dockCollapsed: true });

    render(<WindowSwitcher />);

    // 칩은 없다(접었으니) — 그런데 최소화 창이 갇히면 안 되므로 그 개수는 반드시 보인다.
    expect(screen.queryByText("학생목록")).toBeNull();
    expect(screen.getByText("최소화 1")).toBeTruthy();
  });

  it("펼치기 버튼을 누르면 다시 칩이 보인다(접힘 해제가 영속 설정에 저장)", () => {
    const st = useWindowStore.getState();
    st.open("route", { id: "students", title: "학생목록", href: "/students" });
    st.minimize(windowId("route", "students"));
    usePrefs.setState({ dockCollapsed: true });

    const { rerender } = render(<WindowSwitcher />);
    fireEvent.click(screen.getByText("최소화 1"));
    rerender(<WindowSwitcher />);

    expect(usePrefs.getState().dockCollapsed).toBe(false);
    expect(screen.getByText("학생목록")).toBeTruthy();
  });
});

/**
 * 칩 안 **✕(닫기)** — 원장 지시 2026-08-25 "라벨 옆에 x 추가해서 누르면 해당 창 닫을 수 있도록".
 * 여기서 잠그는 계약은 "닫힌다"보다 **"아무 때나 닫히지 않는다"** 쪽이다: 독은 예전에 스토어 close를
 * 직접 불러 미저장 확인·녹음 잠금·배경 새로고침을 전부 건너뛰었다(가운데클릭이라 아무도 안 눌렀을 뿐).
 * ✕가 눈에 보이는 정식 경로가 된 이상 그 셋을 반드시 지나야 한다.
 */
describe("WindowSwitcher — 칩 안 닫기 버튼", () => {
  beforeEach(() => {
    resetStore();
    refresh.mockClear();
    toastInfo.mockClear();
    toastWarning.mockClear();
  });

  const students = windowId("route", "students");
  const classes = windowId("route", "classes");
  function openTwo() {
    const st = useWindowStore.getState();
    st.open("route", { id: "students", title: "학생목록", href: "/students" });
    st.open("route", { id: "classes", title: "수업목록", href: "/classes" });
  }

  it("깨끗한 창은 닫기 버튼으로 닫히고 배경이 새로고침된다", () => {
    openTwo();
    const { container } = render(<WindowSwitcher />);
    fireEvent.mouseEnter(container.firstChild as HTMLElement); // 자동 숨김 해제(호버)

    fireEvent.click(screen.getByLabelText("학생목록 닫기"));

    expect(useWindowStore.getState().order).not.toContain(students);
    expect(useWindowStore.getState().order).toContain(classes);
    // 창(iframe)과 배경은 별도 문서라 닫기는 배경 새로고침과 한 쌍이다(#55).
    expect(refresh).toHaveBeenCalled();
  });

  it("최소화한 창도 닫기 버튼으로 닫힌다(되살리지 않고 바로)", () => {
    openTwo();
    useWindowStore.getState().minimize(students);

    render(<WindowSwitcher />); // 최소화 창이 있으면 호버 없이도 고정 노출
    fireEvent.click(screen.getByLabelText("학생목록 닫기"));

    expect(useWindowStore.getState().order).not.toContain(students);
  });

  it("미저장(dirty) 창은 닫히지 않고 복원+포커스된다 — 작성 중인 글을 조용히 날리지 않게", () => {
    openTwo();
    const st = useWindowStore.getState();
    st.minimize(students);
    st.setWindowDirty(students, true);

    render(<WindowSwitcher />);
    fireEvent.click(screen.getByLabelText("학생목록 닫기"));

    const after = useWindowStore.getState();
    expect(after.order).toContain(students); // 안 닫혔다
    expect(after.windows[students].minimized).toBe(false); // 복원됐다
    expect(after.focusedId).toBe(students);
    expect(refresh).not.toHaveBeenCalled();
    expect(toastInfo).toHaveBeenCalled(); // 왜 안 닫혔는지 알린다
  });

  it("녹음 중(busy) 창은 닫히지 않는다 — 창 자체 X가 잠기는 것과 같은 축", () => {
    openTwo();
    useWindowStore.getState().setWindowBusy(students, true);

    const { container } = render(<WindowSwitcher />);
    fireEvent.mouseEnter(container.firstChild as HTMLElement);
    fireEvent.click(screen.getByLabelText("학생목록 닫기"));

    expect(useWindowStore.getState().order).toContain(students);
    expect(toastWarning).toHaveBeenCalled();
  });

  it("칩 본체 클릭은 여전히 전환(복원+포커스)이다 — 닫기 버튼이 칩 전체를 먹지 않는다", () => {
    openTwo();
    useWindowStore.getState().minimize(students);

    render(<WindowSwitcher />);
    fireEvent.click(screen.getByText("학생목록"));

    const after = useWindowStore.getState();
    expect(after.order).toContain(students);
    expect(after.windows[students].minimized).toBe(false);
    expect(after.focusedId).toBe(students);
  });

  it("닫기 버튼은 칩 본체 버튼 **안**에 있지 않다(버튼 안 버튼 금지)", () => {
    openTwo();
    useWindowStore.getState().minimize(students);

    render(<WindowSwitcher />);
    const closeBtn = screen.getByLabelText("학생목록 닫기");
    const openBtn = screen.getByLabelText("학생목록 열기");

    expect(closeBtn.closest("button")).toBe(closeBtn); // 자기 자신 = 감싸는 버튼 없음
    expect(openBtn.contains(closeBtn)).toBe(false);
  });

  it("칩은 최근 본 순서로 놓인다 — 지금 보는 창이 맨 앞", () => {
    // 원장 지시 2026-08-25 "항상 보고 있는 창을 가장 앞으로. 최근 본 순서대로 정렬되면 좋을듯".
    // 폭 상한이 생겨 끝쪽 칩은 잘리므로, 지금 보는 창이 끝에 있으면 안 보인다.
    openTwo(); // students → classes 순으로 열었으니 지금 보는 창은 classes
    const { container } = render(<WindowSwitcher />);
    fireEvent.mouseEnter(container.firstChild as HTMLElement);

    const labels = [...container.querySelectorAll("button[aria-label$='열기']")].map((b) =>
      b.getAttribute("aria-label"),
    );
    expect(labels).toEqual(["수업목록 열기", "학생목록 열기"]);

    // 다른 창을 고르면 그 창이 맨 앞으로 온다(스토어 z-스택은 그대로, 표시만 뒤집힌 것).
    fireEvent.click(screen.getByLabelText("학생목록 열기"));
    const after = [...container.querySelectorAll("button[aria-label$='열기']")].map((b) =>
      b.getAttribute("aria-label"),
    );
    expect(after).toEqual(["학생목록 열기", "수업목록 열기"]);
  });

  it("칩 목록은 폭 상한이 걸린 가로 스크롤 영역 안에 있다 — 창이 늘어도 독이 길어지지 않게", () => {
    // 원장 지시 2026-08-25 "목록이 많아지면 너무 가로가 길어보이니까 적당한 목록 보여주고 드래그 스크롤".
    // jsdom엔 레이아웃이 없어 실제 넘침은 못 재므로 **구조**를 잠근다: 칩은 상한 걸린 스크롤 영역 안,
    // 접기/스포트라이트 버튼은 그 **밖**(스크롤되어 사라지면 손잡이를 잃는다).
    openTwo();
    useWindowStore.getState().minimize(students);

    render(<WindowSwitcher />);
    const chip = screen.getByLabelText("학생목록 열기").parentElement as HTMLElement;
    const scrollArea = chip.closest('[class*="max-w-"]') as HTMLElement | null;

    expect(scrollArea).not.toBeNull();
    expect(scrollArea!.className).toContain("max-w-[360px]");
    expect(chip.className).toContain("shrink-0"); // 상한 안에서 칩이 눌려 찌그러지지 않게
    expect(scrollArea!.contains(screen.getByLabelText("독 접기"))).toBe(false);
  });

  it("가운데클릭도 같은 경로를 탄다 — 미저장 창은 안 닫힌다", () => {
    openTwo();
    const st = useWindowStore.getState();
    // 창 3개 — 하나를 닫아도 독이 남아 있어야 두 번째 클릭을 검사할 수 있다(1개면 독 자체가 사라진다).
    st.open("route", { id: "meetings", title: "회의록", href: "/meetings" });
    st.setWindowDirty(students, true);

    const { container } = render(<WindowSwitcher />);
    fireEvent.mouseEnter(container.firstChild as HTMLElement);
    // auxclick은 RTL fireEvent 맵에 없어 직접 만든다(가운데버튼 = button 1).
    const middleClick = (el: HTMLElement) =>
      fireEvent(el, new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 }));

    // ① 깨끗한 창은 가운데클릭으로 닫힌다 — 핸들러가 실제로 붙어 있다는 증거(안 그러면 아래가 헛통과).
    middleClick(screen.getByLabelText("수업목록 열기"));
    expect(useWindowStore.getState().order).not.toContain(classes);

    // ② 미저장 창은 ✕와 똑같이 막힌다.
    middleClick(screen.getByLabelText("학생목록 열기"));
    expect(useWindowStore.getState().order).toContain(students);
  });
});
