import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { EditableDateCell } from "./editable-date-cell";
import { EditableAttendanceCell } from "./editable-attendance-cell";

const actions=vi.hoisted(()=>({dates:vi.fn(),days:vi.fn()}));
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:vi.fn()})}));
vi.mock("@/features/enrollments/server/actions",()=>({updateEnrollmentDates:actions.dates,updateEnrollmentsAttendanceBatch:actions.days}));
beforeEach(()=>vi.clearAllMocks());
const tap=(element:Element)=>fireEvent(element,Object.assign(new MouseEvent("click",{bubbles:true,detail:1}),{pointerType:"touch"}));

it("one touch opens a date editor without saving; a mouse click still only selects",()=>{
 const {container}=render(<EditableDateCell enrollmentId="e1" field="start" value="2026-09-01" />);
 const button=screen.getByRole("button");
 fireEvent.click(button,{detail:1});expect(container.querySelector('input[type="date"]')).toBeNull();
 tap(button);expect(container.querySelector('input[type="date"]')).toHaveValue("2026-09-01");
 expect(actions.dates).not.toHaveBeenCalled();
});
it("keyboard can open a date editor",()=>{
 const {container}=render(<EditableDateCell enrollmentId="e1" field="end" value={null} />);
 fireEvent.click(screen.getByRole("button"),{detail:0});expect(container.querySelector('input[type="date"]')).not.toBeNull();
 expect(actions.dates).not.toHaveBeenCalled();
});
it("반 이동 종료일은 마지막 수강일로 보이며 편집할 때도 같은 날짜다",()=>{
 const {container}=render(<EditableDateCell enrollmentId="old" field="end" value="2026-10-02" isTransferred />);
 const button=screen.getByRole("button",{name:"~2026-10-01"});
 fireEvent.doubleClick(button);
 expect(container.querySelector('input[type="date"]')).toHaveValue("2026-10-01");
 expect(container.querySelector('input[name="endDateInclusive"]')).toHaveValue("1");
});
it("one touch opens attendance-day selection with its current values and never auto-saves",()=>{
 render(<EditableAttendanceCell enrollmentId="e1" classDays={["mon","wed"]} attendanceDays={["wed"]}>수요일만</EditableAttendanceCell>);
 tap(screen.getByRole("button",{name:"수요일만"}));
 expect(screen.getByRole("button",{name:"수"})).toBeInTheDocument();
 expect(screen.getByRole("button",{name:"월"})).toBeInTheDocument();
 expect(actions.days).not.toHaveBeenCalled();
});
