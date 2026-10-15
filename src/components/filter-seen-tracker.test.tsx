import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ pathname: "/students", workspace: false, desktop: false }));
vi.mock("next/navigation", () => ({ usePathname: () => h.pathname }));
vi.mock("@/components/workspace/workspace-enabled", () => ({ useWorkspaceEnabled: () => h.workspace }));
vi.mock("@/components/workspace/use-is-desktop", () => ({ isDesktopNow: () => h.desktop, useIsDesktop: () => h.desktop }));

import { FilterSeenTracker } from "./filter-seen-tracker";
import { FILTER_SEEN_COOKIE, FILTER_SEEN_TOUCH_MS, parseFilterSeen } from "@/lib/filter-reset/rules";

const T0 = Date.UTC(2026, 9, 15, 4, 0, 0);
const S0 = T0 / 1000;
const seen = () => {
  const part = document.cookie.split("; ").find((p) => p.startsWith(`${FILTER_SEEN_COOKIE}=`));
  return parseFilterSeen(part?.slice(FILTER_SEEN_COOKIE.length + 1));
};
let vis: DocumentVisibilityState = "visible";
/** 보임 상태를 바꾸고(바뀌지 않았어도) visibilitychange를 쏜다 — 최소화한 창에도 탭 전환 신호는 온다. */
const visibility = (v: DocumentVisibilityState) => {
  vis = v;
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
};

beforeEach(() => {
  vi.useFakeTimers({ now: T0 });
  document.cookie = `${FILTER_SEEN_COOKIE}=; path=/; max-age=0`;
  Object.assign(h, { pathname: "/students", workspace: false, desktop: false });
  vis = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => vis });
});
afterEach(() => {
  vi.useRealTimers();
  delete (document as unknown as { visibilityState?: unknown }).visibilityState;
});

// 원장 2026-10-15 — 필터 10분 초기화의 '마지막으로 본 시각'(src/lib/filter-reset/rules.ts).
describe("필터 기록기", () => {
  it("필터를 저장하는 화면을 열면 지금을 적고, 보이는 동안 30초마다 · 떠날 때 다시 적는다", () => {
    const { unmount } = render(<FilterSeenTracker />);
    expect(seen().students).toBe(S0);
    act(() => vi.advanceTimersByTime(FILTER_SEEN_TOUCH_MS));
    expect(seen().students).toBe(S0 + FILTER_SEEN_TOUCH_MS / 1000);
    act(() => vi.advanceTimersByTime(5_000));
    unmount();
    expect(seen().students).toBe(S0 + FILTER_SEEN_TOUCH_MS / 1000 + 5);
  });

  it("필터를 저장하지 않는 화면은 적지 않는다", () => {
    h.pathname = "/dashboard";
    render(<FilterSeenTracker />);
    h.pathname = "/consultations";
    render(<FilterSeenTracker />);
    expect(seen()).toEqual({});
  });

  it("🔴 창 엔진을 쓰는 데스크톱의 바깥 문서는 쉰다(창 모드·이전 화면 유지 둘 다 — 화면은 캔버스에 덮여 있다)", () => {
    Object.assign(h, { workspace: true, desktop: true });
    render(<FilterSeenTracker />);
    expect(seen()).toEqual({});
    // 좁은 폭(모바일 셸)에선 바깥 문서가 화면을 그리니 적는다
    h.desktop = false;
    render(<FilterSeenTracker />);
    expect(seen().students).toBe(S0);
  });

  it("가려지는 순간 한 번 적고, 가려져 있는 동안은 간격 기록을 건너뛴다 · 다시 보이면 그때를 적는다", () => {
    render(<FilterSeenTracker />);
    act(() => vi.advanceTimersByTime(5_000));
    visibility("hidden");
    expect(seen().students).toBe(S0 + 5);
    act(() => vi.advanceTimersByTime(5 * FILTER_SEEN_TOUCH_MS));
    expect(seen().students).toBe(S0 + 5);
    visibility("visible");
    expect(seen().students).toBe(S0 + 5 + (5 * FILTER_SEEN_TOUCH_MS) / 1000);
  });

  it("🔴 숨은 채 들어온 신호(최소화한 창에 온 탭 전환·화면 잠금)와 숨은 채 떠나는 것(창 닫기·유지 화면 정리)은 '본 것'이 아니다", () => {
    const { unmount } = render(<FilterSeenTracker />);
    visibility("hidden");
    act(() => vi.advanceTimersByTime(20 * 60_000));
    visibility("hidden"); // 탭 전환 신호 — 이 창은 여전히 숨어 있다
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    unmount();
    expect(seen().students).toBe(S0);
  });
});
