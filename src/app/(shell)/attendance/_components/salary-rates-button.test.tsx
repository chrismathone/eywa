import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SalaryRatesButton } from "./salary-rates-button";

const save = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());
vi.mock("@/features/attendance/server/salary-rates-actions", () => ({ saveAttendanceSalaryRates: save }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const teacherId = "aaaaaaaa-1111-1111-1111-111111111111";
const classId = "bbbbbbbb-1111-1111-1111-111111111111";

describe("administrator salary rate editor", () => {
  beforeEach(() => { vi.clearAllMocks(); save.mockResolvedValue({ ok: true }); });
  const open = () => {
    render(<SalaryRatesButton teacherId={teacherId} teacherName="강사" month="2026-09"
      rates={{ regular: { 초등: 40, 중등: 45, 고등: 50 }, special: { 초등: 55, 중등: 60, 고등: 65 }, classes: {} }}
      classes={[{ id: classId, name: "특강 A" }]} />);
    fireEvent.click(screen.getByRole("button", { name: "비율 설정" }));
  };
  it("saves six independent rates and a class exception without replacing other levels", async () => {
    open();
    fireEvent.change(screen.getByRole("spinbutton", { name: "특강 중등 비율" }), { target: { value: "62.5" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "정규 초등 비율" }), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("특강 A 비율"), { target: { value: "47.5" } });
    fireEvent.submit(screen.getByRole("button", { name: "저장" }).closest("form")!);
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(save).toHaveBeenCalledWith({ teacherId, month: "2026-09", rates: {
      regular: { 초등: 0, 중등: 45, 고등: 50 }, special: { 초등: 55, 중등: 62.5, 고등: 65 }, classes: { [classId]: 47.5 },
    } });
  });
  it("keeps an unsuccessful save open and preserves a deliberately blank rate", async () => {
    save.mockResolvedValue({ ok: false, error: "저장 실패" });
    open();
    fireEvent.change(screen.getByRole("spinbutton", { name: "정규 고등 비율" }), { target: { value: "" } });
    fireEvent.submit(screen.getByRole("button", { name: "저장" }).closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("저장 실패");
    expect(save.mock.calls[0]![0].rates.regular).toEqual({ 초등: 40, 중등: 45 });
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
