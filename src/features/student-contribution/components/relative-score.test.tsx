import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { comparisonOptions } from "../model/relative-score";
import { RelativeScore } from "./relative-score";
afterEach(cleanup);
it("누적·최근 및 비교 대상을 바꾸면 실제 위치와 등급도 함께 바뀐다", () => {
  const rows = Array.from({ length: 11 }, (_, n) => ({ id: String(n), status: "enrolled", grade: n < 6 ? "중2" : "중3", enrolledMonths: 5, total: n * 10, recent: 100 - n * 10, partial: false }));
  render(<RelativeScore options={comparisonOptions(rows, "0")} refreshedAt={null} periodLabel="2025-12 ~ 2026-11" />);
  expect(screen.getByText("11위 / 11명")).toBeTruthy();
  expect(screen.getByText("상위 100%")).toBeTruthy();
  expect(screen.getByRole("img", { name: "최저점 0점, 이 학생 0점, 최고 100점" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("상대평가 점수 기준"), { target: { value: "recent" } });
  expect(screen.getByText("1위 / 11명")).toBeTruthy();
  expect(screen.getByText("상위 9.1%")).toBeTruthy();
  expect(screen.getByRole("img", { name: "최저점 0점, 이 학생 100점, 최고 100점" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("상대평가 비교 대상"), { target: { value: "grade" } });
  expect(screen.getByText("1위 / 6명")).toBeTruthy();
  expect(screen.getByText("상위 16.7%")).toBeTruthy();
});
it("자료 실패는 최하위 등급으로 바꾸지 않는다", () => {
  render(<RelativeScore options={[]} refreshedAt={null} periodLabel="" error="비교 자료를 불러오지 못했습니다." />);
  expect(screen.getByRole("status").textContent).toContain("불러오지 못했습니다");
  expect(screen.queryByText("9등급")).toBeNull();
});
