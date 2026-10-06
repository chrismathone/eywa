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
  linesBySlot: {}, plannedBySlot: {}, shiftBySlot: {}, periodLabelBySlot: {},
  skillAreas: [], holidays: {}, canEdit: true, lessonIndex: {},
} as unknown as ClassSheetMonthData;
const props = { data, goals: {}, display: { homework: true, seat: true } };
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

  it("키 반복은 중복 조작을 만들지 않고 날짜 칸의 기본 동작은 유지한다", () => {
    const onShift = vi.fn();
    const onOpenDay = vi.fn();
    const { container } = render(<MonthCalendar {...props} onOpenDay={onOpenDay} onShift={onShift} />);
    fireEvent.keyDown(screen.getByRole("button", { name: "미룸" }), { key: "Enter", repeat: true });
    expect(onShift).not.toHaveBeenCalled();
    fireEvent.click(container.querySelector("button")!);
    expect(onOpenDay).toHaveBeenCalledExactlyOnceWith("2026-10-07");
  });

  it("교시 줄에 마우스를 올리면 지금 일정 ⇔ 원래 계획(원장 2026-10-06)", () => {
    const pl = (lessonNo: number) => ({
      lessonNo, date: "2026-10-07", slotStart: "16:00", skillArea: "vocab", title: "Vocab Up",
      pageTime: null, progress: null, homework: null, termMode: "regular" as const,
    });
    const withPlan = {
      ...data,
      plannedBySlot: { "2026-10-07|16:00": [pl(3)] },
      scheduledBySlot: { "2026-10-07|16:00": [pl(4)] },
    } as unknown as ClassSheetMonthData;
    const { container } = render(<MonthCalendar {...props} data={withPlan} onOpenDay={vi.fn()} onShift={vi.fn()} />);
    const titles = [...container.querySelectorAll("[title]")].map((el) => el.getAttribute("title"));
    expect(titles).toContain("지금 일정(미룸·당김 반영): Vocab Up 4차수\n⇔ 원래 계획: Vocab Up 3차수");
  });

  it("같으면 한 줄, 일정을 안 실은 옛 데이터면 툴팁 없음", () => {
    const pl = { lessonNo: 3, date: "2026-10-07", slotStart: "16:00", skillArea: "vocab", title: "Vocab Up",
      pageTime: null, progress: null, homework: null, termMode: "regular" as const };
    const same = { ...data, plannedBySlot: { "2026-10-07|16:00": [pl] }, scheduledBySlot: { "2026-10-07|16:00": [pl] } } as unknown as ClassSheetMonthData;
    const r1 = render(<MonthCalendar {...props} data={same} onOpenDay={vi.fn()} onShift={vi.fn()} />);
    expect([...r1.container.querySelectorAll("[title]")].map((el) => el.getAttribute("title"))).toContain(
      "지금 일정 = 원래 계획\nVocab Up 3차수",
    );
    cleanup();
    const old = { ...data, plannedBySlot: { "2026-10-07|16:00": [pl] } } as unknown as ClassSheetMonthData;
    const r2 = render(<MonthCalendar {...props} data={old} onOpenDay={vi.fn()} onShift={vi.fn()} />);
    expect([...r2.container.querySelectorAll("[title]")].some((el) => el.getAttribute("title")?.includes("원래 계획"))).toBe(false);
  });
});
