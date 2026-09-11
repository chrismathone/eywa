import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ pathname: "/attendance/quick" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));
vi.mock("./use-in-frame", () => ({ useInFrame: () => true })); // 창(iframe) 안

import { WindowMinSizeNotice } from "./window-min-size-notice";
import { ROUTE_WINDOW_SIZE, WINDOW_CHROME } from "./window-geometry";

/**
 * 창 안 "최소 폭 미달" 안내 — 그 화면의 최소 폭으로 잰다. 전수검사 2026-09-11: 경로형 면이 부모 창 id로 합쳐진 뒤
 * 출석부 창 안의 출결 모드(560)가 1280 기준으로 재어져, 좁힌 창에 "가로 N px 모자랍니다"가 떴다.
 */

const origWidth = Object.getOwnPropertyDescriptor(window, "innerWidth");
function setWidth(w: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: w });
}
afterEach(() => {
  if (origWidth) Object.defineProperty(window, "innerWidth", origWidth);
  else delete (window as { innerWidth?: number }).innerWidth;
});

describe("WindowMinSizeNotice — 그 화면의 최소 폭으로 잰다", () => {
  it("🔴 출결 모드는 출결 모드 폭이면 안내가 안 뜬다 — 출석부(1280) 기준으로 재지 않는다", () => {
    nav.pathname = "/attendance/quick";
    setWidth(700);
    render(<WindowMinSizeNotice />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("출결 모드 폭보다 좁으면 그 폭 기준으로 모자란 양을 적는다", () => {
    nav.pathname = "/attendance/quick";
    setWidth(400);
    render(<WindowMinSizeNotice />);
    const needed = ROUTE_WINDOW_SIZE["attendance/quick"].w - WINDOW_CHROME.w;
    expect(screen.getByRole("status").textContent).toContain(`${needed}px이 필요한데`);
  });

  it("월별 출석부는 종전대로 1280 기준", () => {
    nav.pathname = "/attendance";
    setWidth(700);
    render(<WindowMinSizeNotice />);
    const needed = ROUTE_WINDOW_SIZE.attendance.w - WINDOW_CHROME.w;
    expect(screen.getByRole("status").textContent).toContain(`${needed}px이 필요한데`);
  });
});
