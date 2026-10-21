import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { windowMinSize, WINDOW_CHROME } from "@/components/workspace/window-geometry";

const frame = vi.hoisted(() => ({ active: false }));
vi.mock("@/components/workspace/use-in-frame", () => ({ useInFrame: () => frame.active }));
import { StatsWidthGate } from "./stats-width-gate";

const originalWidth = window.innerWidth;
const resize = (width: number) => act(() => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  window.dispatchEvent(new Event("resize"));
});
afterEach(() => { cleanup(); resize(originalWidth); frame.active = false; vi.restoreAllMocks(); });

it("좁은 화면에는 차트를 마운트하지 않고, 최소 폭으로 넓히면 차트가 나타난다", () => {
  resize(400);
  render(<StatsWidthGate><div>통계 차트</div></StatsWidthGate>);
  expect(screen.queryByText("통계 차트")).toBeNull();
  expect(screen.getByRole("status")).toHaveTextContent("1,100px 이상");
  expect(screen.queryByRole("button")).toBeNull();
  resize(windowMinSize("students", "/students/stats").w);
  expect(screen.getByText("통계 차트")).toBeInTheDocument();
  expect(screen.queryByRole("status")).toBeNull();
});

it("플로팅 창은 창 테두리를 빼서 판정하고, 부족할 때 최대화를 요청한다", () => {
  frame.active = true;
  const min = windowMinSize("students", "/students/stats").w - WINDOW_CHROME.w;
  resize(min - 1);
  const post = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
  render(<StatsWidthGate><div>통계 차트</div></StatsWidthGate>);
  fireEvent.click(screen.getByRole("button", { name: "창 최대화" }));
  expect(post).toHaveBeenCalledWith({ type: "eywa-window-maximize" }, window.location.origin);
  resize(min);
  expect(screen.getByText("통계 차트")).toBeInTheDocument();
});
