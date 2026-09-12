import { render, screen, within, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { OverviewData } from "@/features/dashboard/overview/model";
import { CurrentClasses } from "./current-classes";
import s from "./overview.module.css";

vi.mock("@/components/workspace/window-link", () => ({
  WindowLink: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
afterEach(cleanup);
const slot = (
  id: string,
  subject: string,
  status: OverviewData["schedule"][number]["status"],
  startTime = "15:00",
): OverviewData["schedule"][number] => ({
  id,
  classId: id,
  className: id,
  subject,
  status,
  startTime,
  endTime: "16:00",
  teacherName: "강사",
  classroomName: "교실",
});

it("과목별로 현재 진행 수업을 우선하고 진행 수업이 없으면 가장 가까운 수업만 보여준다", () => {
  render(
    <CurrentClasses
      subjects={{ english: "영어", math: "수학" }}
      schedule={[
        slot("지난영어", "english", "done", "14:00"),
        slot("현재영어", "english", "ongoing"),
        slot("다음영어", "english", "upcoming", "17:00"),
        slot("먼수학", "math", "upcoming", "18:00"),
        slot("가까운수학", "math", "upcoming", "16:20"),
      ]}
    />,
  );
  const english = screen.getByRole("region", { name: "영어 수업" });
  const math = screen.getByRole("region", { name: "수학 수업" });
  expect(within(english).getByText("진행 중 1개")).toBeTruthy();
  expect(within(english).getByText("현재영어")).toBeTruthy();
  expect(within(english).queryByText("지난영어")).toBeNull();
  expect(within(english).queryByText("다음영어")).toBeNull();
  expect(within(math).getByText("가까운수학")).toBeTruthy();
  expect(within(math).queryByText("먼수학")).toBeNull();
});

it("정기 갱신으로 수업이 끝나면 다음 수업으로 전환한다", () => {
  const view = render(
    <CurrentClasses
      subjects={{ english: "영어" }}
      schedule={[
        slot("수업1", "english", "ongoing"),
        slot("수업2", "english", "upcoming", "16:00"),
      ]}
    />,
  );
  expect(screen.getByText("수업1")).toBeTruthy();
  view.rerender(
    <CurrentClasses
      subjects={{ english: "영어" }}
      schedule={[
        slot("수업1", "english", "done"),
        slot("수업2", "english", "ongoing", "16:00"),
      ]}
    />,
  );
  expect(screen.queryByText("수업1")).toBeNull();
  expect(screen.getByText("수업2")).toBeTruthy();
});

it("전체 일정 팝업 — 진행 중인 수업은 테두리 표식, 열리면 진행 중인 가장 이른 수업으로 스크롤한다", () => {
  const scroll = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
  render(
    <CurrentClasses
      subjects={{ english: "영어", math: "수학" }}
      schedule={[
        slot("지난영어", "english", "done", "14:00"),
        slot("현재수학", "math", "ongoing", "15:10"),
        slot("현재영어", "english", "ongoing", "15:00"),
        slot("다음영어", "english", "upcoming", "17:00"),
      ]}
    />,
  );
  expect(scroll).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "오늘 전체 수업 일정 자세히 보기" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).queryByRole("status")).toBeNull();
  const now = [...dialog.querySelectorAll(`a.${s.scheduleNow}`)].map((a) => a.textContent ?? "");
  expect(now.length).toBe(2);
  expect(now.some((t) => t.includes("현재영어")) && now.some((t) => t.includes("현재수학"))).toBe(true);
  const anchor = dialog.querySelector("a.js-now-anchor");
  expect(anchor?.textContent).toContain("현재영어"); // 15:00 < 15:10 — 배열 순서(현재수학이 앞)가 아니라 시작 시각
  expect(scroll).toHaveBeenCalledTimes(1);
  expect(scroll.mock.instances[0]).toBe(anchor);
  expect(scroll).toHaveBeenCalledWith({ block: "center" });
  scroll.mockRestore();
});

it("전체 일정 팝업 — 진행 중인 수업이 하나도 없으면 맨 위에 '지금 진행중인 수업이 없습니다'와 다음 수업 앵커", () => {
  const scroll = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
  render(
    <CurrentClasses
      subjects={{ english: "영어" }}
      schedule={[
        slot("지난영어", "english", "done", "14:00"),
        slot("더다음영어", "english", "upcoming", "18:00"),
        slot("다음영어", "english", "upcoming", "17:00"),
      ]}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "오늘 전체 수업 일정 자세히 보기" }));
  const dialog = screen.getByRole("dialog");
  const status = within(dialog).getByRole("status");
  expect(status.textContent).toBe("지금 진행중인 수업이 없습니다");
  expect(status.compareDocumentPosition(within(dialog).getByText("지난영어")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(dialog.querySelectorAll(`a.${s.scheduleNow}`).length).toBe(0);
  const anchor = dialog.querySelector("a.js-now-anchor");
  expect(anchor?.textContent).toContain("다음영어"); // 17:00 — 배열엔 18:00이 먼저 온다
  expect(scroll.mock.instances[0]).toBe(anchor);
  scroll.mockRestore();
});
