import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DatePickerButton } from "./date-picker-button";

afterEach(cleanup);
it("날짜 라벨을 클릭하면 달력을 열고 선택한 날짜를 한 번 전달한다", () => {
  const change = vi.fn();
  render(<DatePickerButton value="2026-10-03" max="2026-10-03" label="2026년 10월 3일 (토)" onChange={change} />);
  const input = screen.getByLabelText("날짜 선택") as HTMLInputElement;
  input.showPicker = vi.fn();
  fireEvent.click(screen.getByText("2026년 10월 3일 (토)"));
  expect(input.showPicker).toHaveBeenCalled();
  expect(input.max).toBe("2026-10-03");
  fireEvent.change(input, { target: { value: "2026-10-01" } });
  expect(change).toHaveBeenCalledExactlyOnceWith("2026-10-01");
  expect(document.querySelector("svg")).toBeNull();
});
