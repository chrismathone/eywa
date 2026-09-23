import { act, cleanup, render, screen } from "@testing-library/react";
import { createPortal } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardWidthGate } from "./dashboard-width-gate";

let width: number;
let resize: () => void;
let pointerChange: () => void;
let precisePointer: boolean;
const disconnect = vi.fn();
const removeListener = vi.fn();

beforeEach(() => {
  width = 1920;
  precisePointer = true;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(() => ({ width }) as DOMRect);
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect = disconnect;
  });
  vi.stubGlobal("matchMedia", () => ({
    get matches() { return precisePointer; },
    addEventListener: (_event: string, callback: () => void) => { pointerChange = callback; },
    removeEventListener: removeListener,
  }));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("DashboardWidthGate", () => {
  it("최소 너비에서는 표시하고, 그보다 좁아지면 본문과 포털 팝업을 닫는다", () => {
    render(<DashboardWidthGate><p>대시보드 카드</p>{createPortal(<div role="dialog">상세 팝업</div>, document.body)}</DashboardWidthGate>);
    width = 1180;
    act(() => resize());
    expect(screen.queryByText("대시보드 카드")).not.toBeNull();
    width = 1179;
    act(() => resize());
    expect(screen.queryByText("대시보드 카드")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    width = 1180;
    act(() => resize());
    expect(screen.queryByText("대시보드 카드")).not.toBeNull();
  });

  it("데스크톱을 모바일 폭까지 줄여도 차단을 유지한다", () => {
    width = 390;
    render(<DashboardWidthGate><p>대시보드 카드</p></DashboardWidthGate>);
    act(() => resize());
    expect(screen.queryByText("대시보드 카드")).toBeNull();
  });

  it("모바일·터치는 작은 폭에서도 표시하며 입력 장치 전환도 반영한다", () => {
    width = 390;
    precisePointer = false;
    render(<DashboardWidthGate><p>대시보드 카드</p></DashboardWidthGate>);
    act(() => resize());
    expect(screen.queryByText("대시보드 카드")).not.toBeNull();
    precisePointer = true;
    act(() => pointerChange());
    expect(screen.queryByText("대시보드 카드")).toBeNull();
    precisePointer = false;
    act(() => pointerChange());
    expect(screen.queryByText("대시보드 카드")).not.toBeNull();
  });

  it("화면을 나가면 크기·입력 장치 구독을 정리한다", () => {
    const view = render(<DashboardWidthGate>대시보드</DashboardWidthGate>);
    view.unmount();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(removeListener).toHaveBeenCalledWith("change", pointerChange);
  });
});
