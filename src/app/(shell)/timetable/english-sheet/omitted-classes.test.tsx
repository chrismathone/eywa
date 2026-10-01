import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { OmittedClasses } from "./omitted-classes";
import { preview } from "./test-preview";
import type { MasterInput } from "@/features/timetable/import/master/types";

afterEach(cleanup);
it("시트에서 빠진 반의 종강일·변경 이름·수강 종료 명단을 보여 주고 선택 해제가 가능하다", () => {
  const p = preview(),
    onChange = vi.fn();
  p.omittedClasses = [{ id: "c", name: "PL1", slots: 3 }];
  p.termClosures = [
    {
      classId: "c",
      fromName: "PL1",
      toName: "PL1 (~26.09.30)",
      closedAt: "2026-09-30",
      students: [{ id: "s", name: "남은학생" }],
    },
  ];
  const { rerender } = render(
    <OmittedClasses preview={p} input={{} as MasterInput} pending={false} onChange={onChange} />,
  );
  expect(screen.getByRole("checkbox", { name: "PL1 · 종강" })).toBeChecked();
  expect(screen.getByText(/종강일: 2026-09-30 · 변경 이름: PL1 \(~26.09.30\)/)).toBeVisible();
  expect(screen.getByRole("link", { name: "남은학생" })).toHaveAttribute("href", "/students/s");
  fireEvent.click(screen.getByRole("checkbox"));
  expect(onChange).toHaveBeenCalledWith({ closeClassIds: [] });
  rerender(
    <OmittedClasses
      preview={p}
      input={{ closeClassIds: [] } as unknown as MasterInput}
      pending={false}
      onChange={onChange}
    />,
  );
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  expect(screen.queryByText(/변경 이름:/)).not.toBeInTheDocument();
});
