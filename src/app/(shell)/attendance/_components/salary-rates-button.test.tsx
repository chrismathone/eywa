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
  // 원장 2026-10-07 *"이성우 선생님은 … 고등학생에 대해서만 급여 명세서가 나오도록"* — 대상 학년.
  it("대상 학년 — 기본은 전부(저장값에 칸이 없다), 고등만 남기면 그 학년만 보낸다", async () => {
    open();
    for (const level of ["초등", "중등", "고등"]) expect(screen.getByRole("checkbox", { name: level })).toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "초등" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "중등" }));
    fireEvent.submit(screen.getByRole("button", { name: "저장" }).closest("form")!);
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(save.mock.calls[0]![0].rates.levels).toEqual(["고등"]);
  });
  it("🔴 대상 학년을 전부 끄면 보내지 않고 이유를 말한다 — 아무도 계산되지 않는 설정", async () => {
    open();
    for (const level of ["초등", "중등", "고등"]) fireEvent.click(screen.getByRole("checkbox", { name: level }));
    fireEvent.submit(screen.getByRole("button", { name: "저장" }).closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("대상 학년을 하나 이상 골라 주세요");
    expect(save).not.toHaveBeenCalled();
  });
  it("저장된 대상 학년으로 열린다", () => {
    render(<SalaryRatesButton teacherId={teacherId} teacherName="강사" month="2026-09"
      rates={{ regular: { 고등: 50 }, special: {}, classes: {}, levels: ["고등"] }} classes={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "비율 설정" }));
    expect(screen.getByRole("checkbox", { name: "고등" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "초등" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "중등" })).not.toBeChecked();
  });
  it("고등만 선택한 선생님의 특강 예외를 켜서 저장하고 다시 열어도 유지한다", async () => {
    render(<SalaryRatesButton teacherId={teacherId} teacherName="강사" month="2026-09"
      rates={{ regular: { 고등: 50 }, special: { 초등: 50, 중등: 50, 고등: 50 }, classes: {}, levels: ["고등"], includeSpecial: true }} classes={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "비율 설정" }));
    const toggle = screen.getByRole("checkbox", { name: "특강은 학년 제한 없이 포함" });
    expect(toggle).toBeChecked();
    fireEvent.submit(screen.getByRole("button", { name: "저장" }).closest("form")!);
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(save.mock.calls[0]![0].rates).toMatchObject({ levels: ["고등"], includeSpecial: true });
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
