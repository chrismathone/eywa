import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AttendancePills } from "./attendance-pills";

afterEach(cleanup);

describe("AttendancePills", () => {
  it("권한이 있으면 출석·지각·결석 버튼으로 기록할 수 있다", () => {
    const onSet = vi.fn();
    render(<AttendancePills value={null} pending={false} onSet={onSet} studentName="학원이" />);
    fireEvent.click(screen.getByRole("button", { name: "결석" }));
    expect(onSet).toHaveBeenCalledWith("absent");
  });

  it("권한이 없으면 버튼을 아예 내보내지 않는다(눌러도 서버가 거절하던 거짓 약속 차단)", () => {
    const onSet = vi.fn();
    render(<AttendancePills value={null} pending={false} onSet={onSet} studentName="학원이" readOnly />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByTitle(/출결 입력 권한이 없습니다/)).toBeTruthy();
  });

  it("권한이 없어도 이미 기록된 출결은 한글로 보인다(정보는 숨기지 않는다)", () => {
    render(<AttendancePills value="late" pending={false} onSet={vi.fn()} studentName="학원이" readOnly />);
    expect(screen.getByText("지각")).toBeTruthy();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("기록이 없으면 '출결 —'로 비어 있음을 알린다", () => {
    render(<AttendancePills value={null} pending={false} onSet={vi.fn()} studentName="학원이" readOnly />);
    expect(screen.getByText("출결 —")).toBeTruthy();
  });
});
