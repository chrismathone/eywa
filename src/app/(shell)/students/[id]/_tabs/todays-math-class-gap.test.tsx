import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { TodaysMathClassGap } from "./todays-math-class-gap";

it("names the 에이와 class and says when to ask for a check", () => {
  render(<TodaysMathClassGap gap={{ kind: "sync_pending", aywaClasses: ["중2A", "중2B"] }} />);
  expect(screen.getByText("중2A, 중2B")).toBeTruthy();
  expect(screen.getByText(/에이와에는 지금 수학 반이 있는데/)).toBeTruthy();
  expect(screen.getByText(/확인이 필요하니 관리자에게/)).toBeTruthy();
  expect(screen.getByText(/학생 계정\(로그인\) 발급 여부와는 관계없어요/)).toBeTruthy();
});

it("unknown: no guessed reason, no past classes", () => {
  const { container } = render(<TodaysMathClassGap gap={{ kind: "unknown" }} />);
  expect(screen.getByText(/현재 연결된 수강 반이 없어요/)).toBeTruthy();
  expect(container.textContent).not.toMatch(/지난 반|aywa/);
});
