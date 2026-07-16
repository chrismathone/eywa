import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BriefingAutoRefresh, millisecondsUntilNextKstMidnight } from "./briefing-auto-refresh";
import { useWindowStore } from "@/components/workspace/window-store";

const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

function setVisibility(value: "hidden" | "visible") {
  Object.defineProperty(document, "visibilityState", { configurable: true, value });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("BriefingAutoRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T03:00:00.000Z"));
    refreshMock.mockReset();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    useWindowStore.setState(useWindowStore.getInitialState(), true);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("서버 확인 시각을 KST로 표시하고 5분 뒤 서버 컴포넌트를 다시 요청한다", () => {
    render(<BriefingAutoRefresh checkedAt="2026-07-15T03:34:00.000Z" />);

    expect(screen.getByText("마지막 확인 12:34")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(5 * 60 * 1_000));
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("숨겼던 화면으로 돌아오면 즉시 새로 확인한다", () => {
    render(<BriefingAutoRefresh checkedAt="2026-07-15T03:34:00.000Z" />);

    act(() => setVisibility("hidden"));
    expect(refreshMock).not.toHaveBeenCalled();
    act(() => setVisibility("visible"));
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("열어 둔 화면이 KST 자정을 지나면 오늘 데이터를 다시 요청한다", () => {
    vi.setSystemTime(new Date("2026-07-15T14:59:59.000Z"));
    render(<BriefingAutoRefresh checkedAt="2026-07-15T14:59:59.000Z" />);

    act(() => vi.advanceTimersByTime(1_000));
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("업무 창이 운영실을 덮는 동안 멈추고 복귀하면 한 번 새로 확인한다", () => {
    render(<BriefingAutoRefresh checkedAt="2026-07-15T03:34:00.000Z" />);
    act(() => {
      useWindowStore.getState().open("route", {
        id: "attendance",
        title: "출결 처리",
        href: "/attendance",
      });
    });

    act(() => vi.advanceTimersByTime(5 * 60 * 1_000));
    expect(refreshMock).not.toHaveBeenCalled();

    act(() => useWindowStore.getState().showDesktop());
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });
});

describe("millisecondsUntilNextKstMidnight", () => {
  it("KST 자정 직전에는 남은 1초를 반환한다", () => {
    expect(millisecondsUntilNextKstMidnight(Date.parse("2026-07-15T14:59:59.000Z"))).toBe(1_000);
  });

  it("KST 자정 정각에는 다음 자정까지 하루를 반환한다", () => {
    expect(millisecondsUntilNextKstMidnight(Date.parse("2026-07-15T15:00:00.000Z"))).toBe(
      24 * 60 * 60 * 1_000,
    );
  });
});
