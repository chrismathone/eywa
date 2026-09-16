import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HoverTipLayer } from "@/components/hover-tip/hover-tip-layer";
import type { StudentAttendanceFull } from "@/features/students/server/queries";
import { AttendanceList, MonthCalendar } from "./attendance-panels";

const record: StudentAttendanceFull = {
  date: "2026-09-16", status: "absent", classId: "test-class", className: "테스트 수업", subject: "math",
  slotStart: "16:20:00", seatLabel: null, reporter: null, note: "학교 행사로 결석\n학부모 사전 연락",
};
afterEach(cleanup);

describe("학생 출결 사유 호버", () => {
  it.each(["calendar", "list"])("%s에서도 기록된 사유를 공통 카드로 표시한다", async view => {
    const { container } = render(<>{view === "calendar" ? <MonthCalendar year={2026} month={9} records={[record]} /> : <AttendanceList records={[record]} />}<HoverTipLayer /></>);
    const badge = container.querySelector("[data-tip]")!;
    expect(badge).not.toHaveAttribute("title");
    fireEvent.pointerOver(badge, { clientX: 100, clientY: 100, buttons: 0 });
    const tip = await screen.findByRole("tooltip");
    expect(within(tip).getByText("출결 사유")).toBeInTheDocument();
    expect(tip).toHaveTextContent("학교 행사로 결석");
    expect(tip).toHaveTextContent("학부모 사전 연락");
    expect(tip).toHaveTextContent("테스트 수업");
  });
  it("사유가 없으면 사유 카드를 만들지 않는다", () => {
    const { container } = render(<MonthCalendar year={2026} month={9} records={[{ ...record, note: "  " }]} />);
    expect(container.querySelector("[data-tip]")).toBeNull();
    expect(screen.getByText("결석 테스트 수업 16:20")).toHaveAttribute("title");
  });
});
