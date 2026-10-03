import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useLessonClock } from "./use-lesson-clock";

afterEach(() => { cleanup(); vi.useRealTimers(); });

it("KST 수업 종료와 자정을 열린 목록에서도 따라가며 떠난 뒤에는 타이머를 정리한다", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-03T07:59:50Z"));
  function Clock() { return <output>{useLessonClock()}</output>; }
  const page = render(<Clock />);
  act(() => { vi.advanceTimersByTime(0); });
  expect(screen.getByRole("status")).toHaveTextContent("2026-10-03T16:59");
  act(() => { vi.advanceTimersByTime(30_000); });
  expect(screen.getByRole("status")).toHaveTextContent("2026-10-03T17:00");
  act(() => {
    vi.setSystemTime(new Date("2026-10-03T15:00:00Z"));
    window.dispatchEvent(new Event("focus"));
  });
  expect(screen.getByRole("status")).toHaveTextContent("2026-10-04T00:00");
  page.unmount();
  expect(vi.getTimerCount()).toBe(0);
});
