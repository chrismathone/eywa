import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { TodaysMathClassGap } from "./todays-math-class-gap";

it("names the aywa class and says when to suspect a sync error", () => {
  render(<TodaysMathClassGap gap={{ kind: "sync_pending", aywaClasses: ["중2A", "중2B"], withdrawnAt: null }} pastClasses={[]} />);
  expect(screen.getByText("중2A, 중2B")).toBeTruthy();
  expect(screen.getByText(/확인이 필요하니 관리자에게/)).toBeTruthy();
  expect(screen.getByText("학생 계정(로그인) 발급 여부와는 관계없어요.")).toBeTruthy();
});

it("ended: says the class ended, when, that records stay, and lists the past classes", () => {
  render(<TodaysMathClassGap gap={{ kind: "ended", withdrawnAt: "2026-09-30T15:00:00.000Z" }} pastClasses={["중2A"]} />);
  expect(screen.getByText(/수강 종료로 처리됐어요/)).toBeTruthy();
  expect(screen.getByText(/2026\. 10\. 1\./)).toBeTruthy();
  expect(screen.getByText(/지난 시험 기록은 그대로 남아 있어요/)).toBeTruthy();
  expect(screen.getByText(/중2A/)).toBeTruthy();
});
