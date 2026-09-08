import { useState } from "react";
import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { HoverCard } from "./hover-cards";

/**
 * 시간표 hover 카드가 **화면에 쌓이던 것** — 원장 제보 2026-09-08
 * *"마우스 올린게 다 남아있는데, 마우스가 지나가면 호버링정보 꺼져야할거같은데 안꺼지네"*(스샷에 6장이 겹쳐 있었다).
 *
 * 🔴 원인: 학생 줄은 포인터가 올라오면 무장 컴포넌트로 **갈리면서 DOM 노드가 교체**된다
 *    (`DraggableStudentRow`의 armed/resting 스왑). 커서 아래에서 노드가 떨어져 나가면 브라우저는 그 노드에
 *    `mouseleave`를 **보내지 않는다** → 그 줄의 카드는 열린 채로 굳고, 지나간 줄마다 한 장씩 남는다.
 *
 * 그래서 트리거의 `mouseleave`를 **믿지 않는** 안전망 셋을 잠근다.
 * ⚠️ 스왑은 **엘리먼트 타입을 바꿔** 흉내 낸다(div→section) — React가 노드를 교체하는 실제 경로와 같다.
 *    손으로 `remove()`하면 React가 나중에 자기 자식이 아니라며 unmount에서 터진다(테스트만의 함정).
 */

/** React는 mouseenter를 위임된 mouseover로 합성한다 — 테스트도 같은 경로를 쓴다. */
function hoverIn(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: document.body }));
  });
}

/**
 * 포인터 이동. ⚠️ 좌표를 반드시 준다 — 트리거가 갈린 뒤엔 "커서가 아직 그 줄 자리인가"를 좌표로 판정하고,
 * 테스트 환경의 `getBoundingClientRect()`는 전부 0이라 좌표를 안 주면 (0,0)이 그 자리 **안**으로 잡힌다.
 */
function pointerMoveOn(target: EventTarget, at = { clientX: 500, clientY: 500 }) {
  act(() => {
    target.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, ...at }));
  });
}

describe("HoverCard — 카드가 화면에 쌓이지 않는다", () => {
  it("새 카드가 열리면 이전 카드는 닫힌다(동시에 한 장)", () => {
    render(
      <>
        <HoverCard card={<span>카드 A</span>}>
          <div data-testid="a">줄 A</div>
        </HoverCard>
        <HoverCard card={<span>카드 B</span>}>
          <div data-testid="b">줄 B</div>
        </HoverCard>
      </>,
    );

    hoverIn(screen.getByTestId("a"));
    expect(screen.queryByText("카드 A")).not.toBeNull();

    hoverIn(screen.getByTestId("b"));
    expect(screen.queryByText("카드 B")).not.toBeNull();
    // 🔴 이게 이번 버그의 핵심 — 옛 코드는 A가 그대로 남아 겹쳤다.
    expect(screen.queryByText("카드 A")).toBeNull();
  });

  it("트리거가 다른 노드로 갈려도(무장 스왑) 카드가 굳지 않는다", () => {
    // 실제 화면과 같은 모양으로 흉내 낸다 — `DraggableStudentRow`가 armed/resting **다른 컴포넌트**로
    // 갈리면서 React가 DOM 노드를 교체한다. 옛 노드는 mouseleave 없이 사라진다.
    function Harness() {
      const [armed, setArmed] = useState(false);
      return (
        <>
          <button type="button" data-testid="arm" onClick={() => setArmed(true)}>
            무장
          </button>
          <HoverCard card={<span>카드 A</span>}>
            {armed ? <section data-testid="a">줄 A(무장)</section> : <div data-testid="a">줄 A</div>}
          </HoverCard>
        </>
      );
    }
    render(<Harness />);
    hoverIn(screen.getByTestId("a"));
    expect(screen.queryByText("카드 A")).not.toBeNull();

    act(() => {
      screen.getByTestId("arm").click();
    });
    // 스왑 뒤 커서는 딴 데로 갔다 — 옛 노드는 이미 없어 leave가 안 온다.
    pointerMoveOn(document.body);
    expect(screen.queryByText("카드 A")).toBeNull();
  });

  it("포인터가 트리거 밖으로 나가면 닫힌다(leave가 안 와도)", () => {
    render(
      <>
        <HoverCard card={<span>카드 A</span>}>
          <div data-testid="a">줄 A</div>
        </HoverCard>
        <div data-testid="elsewhere">딴 곳</div>
      </>,
    );
    hoverIn(screen.getByTestId("a"));
    expect(screen.queryByText("카드 A")).not.toBeNull();

    pointerMoveOn(screen.getByTestId("elsewhere"));
    expect(screen.queryByText("카드 A")).toBeNull();
  });

  it("트리거 안에서 움직이는 동안에는 열려 있다", () => {
    render(
      <HoverCard card={<span>카드 A</span>}>
        <div data-testid="a">
          <span data-testid="child">이름</span>
        </div>
      </HoverCard>,
    );
    hoverIn(screen.getByTestId("a"));
    // 자식 위로 움직여도 같은 트리거 안이라 유지된다(안 그러면 이름 위에서 카드가 꺼진다).
    pointerMoveOn(screen.getByTestId("child"));
    expect(screen.queryByText("카드 A")).not.toBeNull();
  });

  it("스크롤·클릭·Esc·창 이탈에도 닫힌다", () => {
    for (const fire of [
      () => document.dispatchEvent(new Event("scroll")),
      () => document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })),
      () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
      () => window.dispatchEvent(new Event("blur")),
    ]) {
      const view = render(
        <HoverCard card={<span>카드 A</span>}>
          <div data-testid="a">줄 A</div>
        </HoverCard>,
      );
      hoverIn(screen.getByTestId("a"));
      expect(screen.queryByText("카드 A")).not.toBeNull();
      act(() => {
        fire();
      });
      expect(screen.queryByText("카드 A")).toBeNull();
      view.unmount();
    }
  });
});
