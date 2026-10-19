import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClassSheetMonthData } from "../server/month-queries";
import { MonthCalendar } from "./month-calendar";

vi.mock("@/features/textbooks/server/compare-actions", () => ({ getSlotPlanCompare: vi.fn() }));

// 이 테스트가 그리는 한 날짜에 필요한 월간 조회 결과만 합성한다.
const data = {
  classId: "class", month: "2026-10", today: "2026-10-03", dows: ["wed"],
  weeks: [{ monday: "2026-10-05", index: 2, dates: ["2026-10-07"] }],
  slotsByDate: { "2026-10-07": [{ slotStart: "16:00", slotEnd: "17:00", teacherLabel: "강사", roomLabel: null, seat: null }] },
  // 🔴 버튼은 **실제 줄이 있는 칸에만** 선다(원장 2026-10-19 "계획만 있으면 버튼 숨겨").
  linesBySlot: {
    "2026-10-07|16:00": [
      { id: "l1", planDate: "2026-10-07", slotStart: "16:00", termMode: "regular", skillArea: "grammar", lineNo: 1,
        textbook: "SKY", pageRange: "25분", progress: "Unit 1", homework: null, updatedAt: "" },
    ],
  },
  plannedBySlot: {}, shiftBySlot: {}, periodLabelBySlot: {},
  skillAreas: [], holidays: {}, canEdit: true, lessonIndex: {},
} as unknown as ClassSheetMonthData;
const props = { data, goals: {}, display: { homework: true, seat: true } };
/** 실제 줄이 없고 월간계획만 있는 칸. */
const planOnly = {
  ...data,
  linesBySlot: {},
  plannedBySlot: {
    "2026-10-07|16:00": [{ lessonNo: 1, date: "2026-10-07", slotStart: "16:00", skillArea: "grammar", title: "SKY",
      pageTime: "25분", progress: "Unit 1", homework: null, termMode: "regular" }],
  },
} as unknown as ClassSheetMonthData;
afterEach(cleanup);

describe("월간 달력 내부 조작", () => {
  it("SSR HTML에 중첩 native button이 없다 — HTML 파서가 셸 밖 노드를 만들지 않게 한다", () => {
    const html = renderToString(<MonthCalendar {...props} onOpenDay={vi.fn()} onShift={vi.fn()} />);
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.querySelectorAll("button")).toHaveLength(1);
    expect(doc.querySelectorAll('span[role="button"][tabindex="0"]')).toHaveLength(2);
  });

  it.each(["click", "Enter", " "])("%s로 미루기만 실행하고 날짜 편집은 열지 않는다", (key) => {
    const onShift = vi.fn();
    const onOpenDay = vi.fn();
    render(<MonthCalendar {...props} onOpenDay={onOpenDay} onShift={onShift} />);
    const shift = screen.getByRole("button", { name: "미룸" });
    if (key === "click") fireEvent.click(shift);
    else { fireEvent.keyDown(shift, { key }); fireEvent.keyUp(shift, { key }); }
    expect(onShift).toHaveBeenCalledExactlyOnceWith("2026-10-07", "16:00", "skip");
    expect(onOpenDay).not.toHaveBeenCalled();
  });

  it("🔴 월간계획만 있고 실제 줄이 없는 칸엔 미룸·당김이 없다(원장 2026-10-19)", () => {
    render(<MonthCalendar {...props} data={planOnly} onOpenDay={vi.fn()} onShift={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "미룸" })).toBeNull();
    expect(screen.queryByRole("button", { name: "당김" })).toBeNull();
  });

  it("키 반복은 중복 조작을 만들지 않고 날짜 칸의 기본 동작은 유지한다", () => {
    const onShift = vi.fn();
    const onOpenDay = vi.fn();
    const { container } = render(<MonthCalendar {...props} onOpenDay={onOpenDay} onShift={onShift} />);
    fireEvent.keyDown(screen.getByRole("button", { name: "미룸" }), { key: "Enter", repeat: true });
    expect(onShift).not.toHaveBeenCalled();
    fireEvent.click(container.querySelector("button")!);
    expect(onOpenDay).toHaveBeenCalledExactlyOnceWith("2026-10-07");
  });
});
